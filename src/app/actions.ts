"use server";

/**
 * Server Actions — thin Next.js adapter layer.
 *
 * This file ONLY handles:
 *   1. Next.js server action boundary (exports, analytics tracking, headers())
 *   2. Delegating to service/domain modules for all business logic
 *
 * No orchestration, no raw GitHub shapes, no inline context building.
 */

import { headers } from "next/headers";
import type { ReportFalsePositiveReason } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-auth";
import { kv } from "@vercel/kv";
import {
    getProfile,
    getRepo,
    getDefaultBranchHeadSha,
    getRepoFileTree,
    getFileContentBatch,
    getFileContentBatchWithStats,
    getProfileReadme,
    getUserRepos,
    getRepoReadme,
    getRecentProfileCommitsSnapshot,
} from "@/lib/github";
import {
    trackEvent,
    trackAuthenticatedQueryEvent,
    getPublicStats,
    trackReportConversionEvent,
    resetReportConversionMetrics,
    type ReportConversionEvent,
} from "@/lib/analytics";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { SearchResult } from "@/lib/search-engine";
import { getCachedSecurityScanResult, cacheSecurityScanResult } from "@/lib/cache";
import type { CacheAudience, FileCachePolicy } from "@/lib/cache";
import type { ModelPreference } from "@/lib/ai-client";

// ─── Services & Domain ────────────────────────────────────────────────────────
import {
    executeRepoQuery,
    executeRepoQueryStream,
} from "@/lib/services/query-pipeline";
import {
    buildScanConfig,
    runSecurityScan,
} from "@/lib/services/security-service";
import {
    saveScanResult,
    getLatestScanId,
    getScanResultWithStatus,
} from "@/lib/services/scan-storage";
import { recordSearch, getRecentSearches as _getRecentSearches } from "@/lib/services/history-service";
import {
    searchRepositoryCode as _searchRepositoryCode,
} from "@/lib/services/artifact-service";
import {
    createScanShareLink as createScanShareLinkRecord,
    resolveScanFromShareToken as resolveScanFromShareTokenRecord,
} from "@/lib/services/scan-share-links";
import {
    toProfileContext,
    buildProfileContextString,
    buildRepoReadmeEntry,
    type RepoReadmeSummary,
} from "@/lib/domain";
import { analyzeFileSelection, answerWithContext, answerWithContextStream } from "@/lib/gemini";
import { mapProfileStreamChunk } from "@/lib/profile-stream";
import { buildOutreachPack, findingFingerprint as buildFindingFingerprint } from "@/lib/services/report-service";
import { getPublicSiteUrl } from "@/lib/site-url";
import { getSessionUserId } from "@/lib/session-guard";
import { canAccessPrivateReport } from "@/lib/services/report-access";
import {
    createFalsePositiveSubmission,
    updateFalsePositiveStatus,
} from "@/lib/services/report-false-positives";
import { saveScanFindingVerificationRecords } from "@/lib/services/finding-verification-store";
import {
    finalizeFixVerificationRun,
    startFixVerificationRun,
} from "@/lib/services/fix-verification";
import { getRepoSuggestions as _getRepoSuggestions } from "@/lib/services/repo-suggestions";
import { prisma } from "@/lib/db";

const FALSE_POSITIVE_REASONS = new Set<ReportFalsePositiveReason>([
    "NOT_A_VULNERABILITY",
    "TEST_OR_FIXTURE",
    "FALSE_DATAFLOW",
    "INTENDED_BEHAVIOR",
    "OTHER",
]);

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return String(error);
}

function classifyStreamError(error: unknown): { message: string; code?: string } {
    const message = getErrorMessage(error) || "An error occurred";
    if (/missing a thought_signature|thought_signature/i.test(message)) {
        return {
            message: "AI tool-call handoff failed while streaming (missing thought signature). Please retry.",
            code: "AI_MISSING_THOUGHT_SIGNATURE",
        };
    }
    if (/function response turn comes immediately after a function call turn/i.test(message)) {
        return {
            message: "AI tool-call handoff failed while streaming. Please retry.",
            code: "AI_FUNCTION_TURN_ORDER",
        };
    }
    return { message };
}

// ─── Private: Analytics tracking ─────────────────────────────────────────────

/**
 * Fire-and-forget analytics event.
 * Reads headers at this function's top level (required by Next.js 15).
 */
async function trackQueryEvent(visitorId: string | undefined): Promise<void> {
    const session = await auth();
    
    // If authenticated, we use trackAuthenticatedQueryEvent which handles 
    // migration from anonId (visitorId) and excludes admins.
    if (session?.user?.id) {
        await trackAuthenticatedQueryEvent(session.user.id, visitorId);
        return;
    }

    if (process.env.NODE_ENV === "development" && process.env.TRACK_ANALYTICS_IN_DEV !== "true") {
        console.log("[Analytics] Skipped (dev). Set TRACK_ANALYTICS_IN_DEV=true to enable.");
        return;
    }

    if (!visitorId) return;

    try {
        const h = await headers();
        const userAgent = h.get("user-agent") ?? "";
        const country = h.get("x-vercel-ip-country") ?? "Unknown";
        const device = /mobile/i.test(userAgent) ? "mobile" : "desktop";
        await trackEvent(visitorId, "query", { country, device, userAgent });
    } catch (e) {
        console.error("Analytics tracking failed:", e);
    }
}

async function requireAuthenticatedActor() {
    const session = await auth();
    if (!session?.user) {
        throw new Error("Unauthorized");
    }
    return { session, userId: getSessionUserId(session) };
}

// ─── Private: Profile context ─────────────────────────────────────────────────

interface ProfileQueryInput {
    username: string;
    profile: GitHubProfile;
    profileReadme: string | null;
    repoReadmes: RepoReadmeSummary[];
    recentCommits?: Array<{
        repo: string;
        message: string;
        date: string | null;
        sha: string;
    }>;
    recentCommitFreshnessLabel?: string;
}

async function buildFullProfileContext(
    input: ProfileQueryInput,
    query: string,
    onProgress?: (msg: string) => void
): Promise<string> {
    const ctx = toProfileContext(input.profile);
    let context = buildProfileContextString(ctx, input.profileReadme);

    const readmeResults = await Promise.all(
        input.repoReadmes.map(async (readme) => {
            let content = readme.content;
            if (!content && query.toLowerCase().includes(readme.repo.toLowerCase())) {
                onProgress?.(`Reading ${readme.repo}...`);
                content = (await getRepoReadme(input.username, readme.repo)) ?? "";
            }
            return buildRepoReadmeEntry({ ...readme, content });
        })
    );

    context += readmeResults.join("");

    if (input.recentCommits && input.recentCommits.length > 0) {
        const commitLines = input.recentCommits.slice(0, 20).map((commit) => {
            const when = commit.date ?? "unknown-date";
            return `- [${commit.repo}] ${commit.sha}: ${commit.message} (${when})`;
        });
        context += `\n--- RECENT COMMITS SNAPSHOT (${input.recentCommitFreshnessLabel ?? "just now"}) ---\n${commitLines.join("\n")}\n`;
    }

    return context || `No profile data found for ${input.username}.`;
}

const PROFILE_PATH_SKIP_PATTERN =
    /(\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css|woff|woff2|ttf|otf|eot)|package-lock\.json|yarn\.lock)$/i;

function pruneProfileRepoPaths(paths: string[]): string[] {
    return paths.filter(
        (path) =>
            !PROFILE_PATH_SKIP_PATTERN.test(path) &&
            !path.includes("node_modules/") &&
            !path.includes(".git/")
    );
}

function buildProfileFolderStructure(paths: string[], maxPaths: number = 300, maxLines: number = 160): string {
    const limited = paths.slice(0, maxPaths);
    const tree = new Map<string, Set<string>>();

    for (const path of limited) {
        const parts = path.split("/").filter(Boolean);
        if (parts.length === 0) continue;
        const dir = parts.slice(0, -1).join("/") || ".";
        const file = parts[parts.length - 1];
        if (!tree.has(dir)) {
            tree.set(dir, new Set<string>());
        }
        tree.get(dir)?.add(file);
    }

    const lines: string[] = [];
    for (const dir of Array.from(tree.keys()).sort()) {
        lines.push(`- ${dir === "." ? "(root)" : `${dir}/`}`);
        if (lines.length >= maxLines) break;
        const files = Array.from(tree.get(dir) ?? []).sort().slice(0, 8);
        for (const file of files) {
            lines.push(`  - ${file}`);
            if (lines.length >= maxLines) break;
        }
        if (lines.length >= maxLines) break;
    }

    if (paths.length > maxPaths || lines.length >= maxLines) {
        lines.push("- ... (folder structure truncated)");
    }

    return lines.length > 0 ? lines.join("\n") : "- (No repository files available)";
}

async function buildCrossRepoContext(
    input: ProfileQueryInput,
    query: string,
    modelPreference: ModelPreference,
    fileCachePolicy: FileCachePolicy,
    onProgress?: (msg: string) => void
): Promise<{ context: string; selectedFiles: number; cacheHits: number; fetchedFromGitHub: number; failed: number }> {
    const { countTokens, MAX_TOKENS } = await import("@/lib/tokens");
    const maxSelectedFiles = modelPreference === "thinking" ? 50 : 25;
    const maxTokenBudget = Math.floor(MAX_TOKENS * 0.5);
    let selectedFilesCount = 0;
    let tokenTotal = 0;
    let cacheHits = 0;
    let fetchedFromGitHub = 0;
    let failed = 0;
    let crossRepoContext = "\n--- CROSS-REPO CONTEXT ---\n";

    const candidateRepos = input.repoReadmes
        .slice()
        .sort((a, b) => b.stars - a.stars)
        .slice(0, 10);

    for (const repoSummary of candidateRepos) {
        if (selectedFilesCount >= maxSelectedFiles) break;

        const repoName = repoSummary.repo;
        onProgress?.(`Reading repository ${repoName}...`);

        try {
            const repoMeta = await getRepo(input.username, repoName);
            const { tree } = await getRepoFileTree(
                input.username,
                repoName,
                repoMeta.default_branch
            );
            const pathToSha = new Map<string, string>();
            for (const node of tree) {
                if (node.type !== "blob") continue;
                if (typeof node.sha === "string" && node.sha.length > 0) {
                    pathToSha.set(node.path, node.sha);
                }
            }
            const prunedPaths = pruneProfileRepoPaths(Array.from(pathToSha.keys()));
            const remainingBudget = maxSelectedFiles - selectedFilesCount;
            if (remainingBudget <= 0 || prunedPaths.length === 0) {
                continue;
            }

            onProgress?.(`Selecting files in ${repoName}...`);
            const selectedFiles = (await analyzeFileSelection(
                query,
                prunedPaths,
                input.username,
                repoName,
                modelPreference,
                [],
                fileCachePolicy
            )).slice(0, remainingBudget);

            if (selectedFiles.length === 0) {
                continue;
            }

            onProgress?.(`Reading ${selectedFiles.length} files from ${repoName}...`);
            const { files: fileResults, stats } = await getFileContentBatchWithStats(
                input.username,
                repoName,
                selectedFiles.map((path) => ({ path, sha: pathToSha.get(path) })),
                {
                    ...fileCachePolicy,
                    visibility: repoMeta.private ? "private" : "public",
                }
            );
            cacheHits += stats.cacheHits;
            fetchedFromGitHub += stats.fetchedFromGitHub;
            failed += stats.failed;

            const folderStructure = buildProfileFolderStructure(prunedPaths);
            let repoSection =
                `\n--- REPOSITORY: ${input.username}/${repoName} ---\n` +
                `\n--- REPOSITORY FOLDER STRUCTURE ---\n${folderStructure}\n` +
                `\n--- SELECTED FILES ---\n${selectedFiles.map((path) => `- ${path}`).join("\n")}\n`;

            for (const file of fileResults) {
                if (!file.content) continue;
                const fileTokens = countTokens(file.content);
                if (tokenTotal + fileTokens > maxTokenBudget) {
                    repoSection += "\n--- NOTE: Cross-repo context truncated at token budget ---\n";
                    break;
                }
                repoSection += `\n--- FILE: ${repoName}/${file.path} ---\n${file.content}\n`;
                tokenTotal += fileTokens;
            }

            crossRepoContext += repoSection;
            selectedFilesCount += selectedFiles.length;
        } catch (error) {
            console.warn(`Skipping cross-repo context for ${repoName}:`, error);
        }
    }

    return {
        context: crossRepoContext,
        selectedFiles: selectedFilesCount,
        cacheHits,
        fetchedFromGitHub,
        failed,
    };
}

// ─── Public Actions — Data Fetching ──────────────────────────────────────────

export async function fetchGitHubData(input: string) {
    const parts = input.split("/");
    const session = await auth();

    if (parts.length === 1) {
        try {
            const data = await getProfile(parts[0]);
            if (session?.user?.id) {
                await recordSearch(session.user.id, parts[0], "profile");
            }
            return { type: "profile", data };
        } catch (e: unknown) {
            return { error: `User not found: ${getErrorMessage(e)}` };
        }
    }
    if (parts.length === 2) {
        const [owner, repo] = parts;
        try {
            const repoData = await getRepo(owner, repo);
            const { tree, hiddenFiles } = await getRepoFileTree(
                owner,
                repo,
                repoData.default_branch
            );
            if (session?.user?.id) {
                await recordSearch(session.user.id, input, "repo");
            }
            return { type: "repo", data: repoData, fileTree: tree, hiddenFiles };
        } catch (e: unknown) {
            return { error: `Repository not found: ${getErrorMessage(e)}` };
        }
    }
    return { error: "Invalid input format" };
}

export async function getRepoSuggestions(query: string) {
    return _getRepoSuggestions(query);
}

export async function fetchProfile(username: string) {
    return getProfile(username);
}

export async function fetchRecentProfileCommitSnapshot(username: string) {
    return getRecentProfileCommitsSnapshot(username, 20);
}

export async function fetchGitHubAvatarUrl(username: string) {
    try {
        const profile = await getProfile(username);
        return { url: profile.avatar_url };
    } catch (e) {
        console.error("Failed to fetch GitHub avatar URL:", e);
        return { error: "Failed to fetch avatar" };
    }
}

export async function fetchPublicStats() {
    return getPublicStats();
}

export async function trackReportConversion(event: ReportConversionEvent, scanId?: string) {
    const session = await auth();
    await trackReportConversionEvent(event, scanId, {
        actorUsername: session?.user?.username ?? null,
    });
}

/**
 * Fetch file content and assemble a context string.
 * @deprecated Prefer generateAnswer(query, ..., filePaths) which uses the
 * unified query pipeline. This export is kept for ChatInterface.tsx
 * backwards-compatibility.
 */
export async function fetchRepoFiles(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>
): Promise<{ context: string; fetchedFiles: string[] }> {
    const { countTokens, MAX_TOKENS } = await import("@/lib/tokens");
    const results = await getFileContentBatch(owner, repo, files);

    let context = "";
    let tokenTotal = 0;
    const fetchedFiles: string[] = [];

    for (const { path, content } of results) {
        if (!content) continue;
        const tokens = countTokens(content);
        if (tokenTotal + tokens > MAX_TOKENS) {
            context += `\n--- NOTE: Context truncated at ${MAX_TOKENS.toLocaleString()} token limit ---\n`;
            break;
        }
        context += `\n--- FILE: ${path} ---\n${content}\n`;
        tokenTotal += tokens;
        fetchedFiles.push(path);
    }

    return { context, fetchedFiles };
}


export async function fetchProfileReadme(username: string) {
    return getProfileReadme(username);
}

export async function fetchUserRepos(username: string) {
    const repos = await getUserRepos(username);
    return repos.map((r) => ({
        repo: r.name,
        content: "",
        updated_at: r.updated_at,
        description: r.description,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
    }));
}

export async function fetchRepoDetails(owner: string, repo: string) {
    return getRepo(owner, repo);
}

// ─── Public Actions — Repo Query Pipeline ────────────────────────────────────

/**
 * Step 1: Select relevant files for a query (thin adapter over query-pipeline).
 * Kept as a separate action so clients can report file selection progress.
 */
export async function analyzeRepoFiles(
    query: string,
    filePaths: string[],
    owner?: string,
    repo?: string,
    modelPreference: ModelPreference = "flash"
): Promise<{ relevantFiles: string[]; fileCount: number }> {
    // For backwards compatibility (some callers only want the file list),
    // we run the selection step directly from gemini rather than the full pipeline
    const { analyzeFileSelection } = await import("@/lib/gemini");
    const SKIP = /\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css)$/i;
    const pruned = filePaths.filter(
        (p) => !SKIP.test(p) && !p.includes("node_modules/") && !p.includes(".git/")
    );
    const relevantFiles = await analyzeFileSelection(query, pruned, owner, repo, modelPreference);
    return { relevantFiles, fileCount: relevantFiles.length };
}

/**
 * Step 2+3 combined: fetch files + generate answer (non-streaming).
 * Thin adapter — delegates entirely to the query pipeline.
 */
export async function generateAnswer(
    query: string,
    context: string,
    repoDetails: { owner: string; repo: string },
    history: { role: "user" | "model"; content: string }[] = [],
    profileData?: GitHubProfile,
    visitorId?: string,
    filePaths?: string[],
    modelPreference: ModelPreference = "flash"
): Promise<string> {
    await trackQueryEvent(visitorId);

    if (!filePaths?.length) {
        // Fallback: if no file paths, answer with the pre-built context
        return answerWithContext(query, context, repoDetails, profileData, history, modelPreference);
    }

    const { answer } = await executeRepoQuery({
        query,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        filePaths,
        history,
        profileData,
        modelPreference,
    });
    return answer;
}

/**
 * Streaming variant of the repo query pipeline — yields StreamUpdate events
 * directly from the unified generator.
 */
export async function* generateAnswerStream(
    query: string,
    repoDetails: { owner: string; repo: string },
    filePaths: string[],
    fileShas?: Record<string, string>,
    cacheAudience: CacheAudience = "authenticated",
    cacheActorId?: string,
    history: { role: "user" | "model"; content: string }[] = [],
    profileData?: GitHubProfile,
    modelPreference: ModelPreference = "flash"
): AsyncGenerator<StreamUpdate> {
    let visibility: "public" | "private" = "public";
    try {
        const repo = await getRepo(repoDetails.owner, repoDetails.repo) as { private?: boolean };
        visibility = repo.private ? "private" : "public";
    } catch {
        visibility = "public";
    }

    const fileCachePolicy: FileCachePolicy = {
        audience: cacheAudience,
        actorId: cacheActorId,
        visibility,
    };

    yield* executeRepoQueryStream({
        query,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        filePaths,
        fileShas,
        fileCachePolicy,
        history,
        profileData,
        modelPreference,
    });
}

// ─── Public Actions — Profile Mode ───────────────────────────────────────────

export async function processProfileQuery(
    query: string,
    profileContext: ProfileQueryInput,
    visitorId?: string,
    history: { role: "user" | "model"; content: string }[] = [],
    modelPreference: ModelPreference = "flash"
) {
    await trackQueryEvent(visitorId);
    const context = await buildFullProfileContext(profileContext, query);
    const answer = await answerWithContext(
        query,
        context,
        { owner: profileContext.username, repo: "profile" },
        profileContext.profile,
        history,
        modelPreference
    );
    return { answer };
}

export async function* processProfileQueryStream(
    query: string,
    profileContext: ProfileQueryInput,
    modelPreference: ModelPreference = "flash",
    options: {
        cacheAudience?: CacheAudience;
        cacheActorId?: string;
        crossRepoEnabled?: boolean;
        history?: { role: "user" | "model"; content: string }[];
    } = {}
): AsyncGenerator<StreamUpdate> {
    const isThinking = modelPreference === "thinking";
    const cacheAudience = options.cacheAudience ?? "anonymous";
    const cacheActorId = options.cacheActorId;
    const history = options.history ?? [];
    let commitFreshnessLabel = profileContext.recentCommitFreshnessLabel;
    const toolsUsed = new Set<string>();
    const pipelineStartMs = Date.now();
    let contextBuildMs = 0;
    let crossRepoMs = 0;
    let answerMs = 0;
    let crossRepoSelectedFiles = 0;

    try {
        console.log(`[processProfileQueryStream] Starting query: "${query}" for user: ${profileContext.username}`);
        yield {
            type: "status",
            message: isThinking
                ? `Reasoning: Analyzing ${profileContext.username}'s GitHub profile and repository data...`
                : "Loading profile data...",
            progress: 20
        };

        if (!profileContext.recentCommits || profileContext.recentCommits.length === 0) {
            console.log(`[processProfileQueryStream] No commits in context, fetching fresh for ${profileContext.username}...`);
            const snapshot = await getRecentProfileCommitsSnapshot(profileContext.username, 20);
            if (snapshot.success) {
                profileContext = {
                    ...profileContext,
                    recentCommits: snapshot.data.commits,
                    recentCommitFreshnessLabel: snapshot.data.freshness.label,
                };
                commitFreshnessLabel = `Commits checked: ${snapshot.data.freshness.label}`;
                console.log(`[processProfileQueryStream] Fetched ${snapshot.data.commits.length} commits.`);
            } else {
                console.warn(`[processProfileQueryStream] Failed to fetch commits:`, snapshot.error);
                profileContext = {
                    ...profileContext,
                    recentCommits: [],
                    recentCommitFreshnessLabel: "GitHub API Unavailable"
                };
                commitFreshnessLabel = "Commits checked: GitHub API Unavailable";
            }
        } else if (profileContext.recentCommitFreshnessLabel) {
            commitFreshnessLabel = `Commits checked: ${profileContext.recentCommitFreshnessLabel}`;
        }

        const contextStartMs = Date.now();
        let context = await buildFullProfileContext(
            profileContext,
            query,
            () => { /* progress updates are fire-and-forget in this path */ }
        );
        contextBuildMs = Date.now() - contextStartMs;
        yield {
            type: "status",
            message: `Profile context prepared from ${profileContext.repoReadmes.length} repositories.`,
            progress: 30,
        };

        if (options.crossRepoEnabled && cacheAudience === "authenticated") {
            yield {
                type: "status",
                message: "Reading repositories for cross-repo context...",
                progress: 35,
            };

            const fileCachePolicy: FileCachePolicy = {
                audience: cacheAudience,
                actorId: cacheActorId,
                visibility: "public",
            };
            const crossRepoStartMs = Date.now();
            const crossRepo = await buildCrossRepoContext(
                profileContext,
                query,
                modelPreference,
                fileCachePolicy,
                () => { /* status updates are emitted at phase boundaries */ }
            );
            crossRepoMs = Date.now() - crossRepoStartMs;
            context += `\n${crossRepo.context}`;
            crossRepoSelectedFiles = crossRepo.selectedFiles;
            yield {
                type: "status",
                message: `Cross-repo context prepared from ${crossRepo.selectedFiles} selected files in ${crossRepoMs}ms...`,
                progress: 55,
            };
            yield {
                type: "status",
                message: `Cross-repo cache hit ${crossRepo.cacheHits}; fetched ${crossRepo.fetchedFromGitHub} from GitHub${crossRepo.failed > 0 ? ` (${crossRepo.failed} unavailable)` : ""}.`,
                progress: 60,
            };
        }

        console.log(`[processProfileQueryStream] Context built (${context.length} chars). Launching Gemini answer stream...`);
        yield {
            type: "status",
            message: isThinking
                ? `Process: Formulating insights based on profile, repositories, and your query — "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"...`
                : "Checking real-time data and preparing response...",
            progress: 75
        };

        const stream = answerWithContextStream(
            query,
            context,
            { owner: profileContext.username, repo: "profile" },
            profileContext.profile,
            history,
            modelPreference
        );
        const answerStartMs = Date.now();

        for await (const chunk of stream) {
            if (chunk.startsWith("META:")) {
                try {
                    const parsed = JSON.parse(chunk.replace("META:", "").trim()) as {
                        commitFreshnessLabel?: unknown;
                    };
                    if (typeof parsed.commitFreshnessLabel === "string") {
                        commitFreshnessLabel = parsed.commitFreshnessLabel;
                    }
                } catch {
                    // Ignore malformed META payloads.
                }
                continue;
            }

            const mapped = mapProfileStreamChunk(chunk);
            if (mapped.type === "tool") {
                toolsUsed.add(mapped.name);
            }
            yield mapped;
        }
        answerMs = Date.now() - answerStartMs;
        const nonWebToolsUsed = Array.from(toolsUsed).filter((tool) => tool !== "googleSearch");
        const hasTools = nonWebToolsUsed.length > 0;
        const sourceScope = toolsUsed.has("googleSearch")
            ? (crossRepoSelectedFiles > 0 ? "Profile + cross-repo + GitHub tools + web snapshot" : "Profile + GitHub tools + web snapshot")
            : (crossRepoSelectedFiles > 0
                ? (hasTools ? "Profile + cross-repo + GitHub tools" : "Profile + cross-repo")
                : (hasTools ? "Profile + GitHub tools" : "Profile context only"));
        const processingSummary = [
            `Profile context: ${contextBuildMs}ms`,
            ...(crossRepoSelectedFiles > 0 ? [`Cross-repo context: ${crossRepoMs}ms (${crossRepoSelectedFiles} files)`] : []),
            `Answer generation: ${answerMs}ms`,
            `Total: ${Date.now() - pipelineStartMs}ms`,
        ];

        yield {
            type: "complete",
            relevantFiles: [],
            metadata: {
                commitFreshnessLabel,
                toolsUsed: toolsUsed.size > 0 ? Array.from(toolsUsed) : undefined,
                processingSummary,
                sourceScope,
            },
        };
    } catch (error: unknown) {
        console.error("Profile stream error:", error);
        const classified = classifyStreamError(error);
        yield { type: "error", message: classified.message || "An error occurred", code: classified.code };
    }
}

// ─── Public Actions — Security Scanning ──────────────────────────────────────

export interface SecurityScanOptions {
    includePatterns?: string[];
    excludePatterns?: string[];
    maxFiles?: number;
    depth?: "quick" | "deep";
    analysisProfile?: "quick" | "deep";
    aiAssist?: "off" | "on";
    enableAi?: boolean;
    aiMaxFiles?: number;
    confidenceThreshold?: number;
    selectedPaths?: string[];
    filePaths?: string[];
}

type SecurityScanCoreResult = Awaited<ReturnType<typeof runSecurityScan>>;
type SecurityScanResult = SecurityScanCoreResult & { scanId?: string };
const DEEP_SCAN_MONTHLY_LIMIT = 15;

export async function scanRepositoryVulnerabilities(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    options: SecurityScanOptions = {}
): Promise<SecurityScanResult> {
    const config = buildScanConfig(options);
    const filePaths = files.map(f => f.path);

    const session = await auth();
    const isAdmin = isAdminUser(session);
    let limitKey = "";

    if (config.analysisProfile === "deep") {
        if (!session?.user?.id) {
            throw new Error("Authentication required for Deep Scan.");
        }
        if (!isAdmin) {
            const now = new Date();
            const monthKey = `${now.getFullYear()}_${now.getMonth() + 1}`;
            limitKey = `user:${session.user.id}:deep_scans:${monthKey}`;
        }
    }

    // Check cache first using commit-aware keying
    let revision = "unknown";
    try {
        revision = await getDefaultBranchHeadSha(owner, repo);
    } catch {
        console.warn(`Failed to resolve latest default-branch SHA for ${owner}/${repo}; using fallback revision key.`);
    }
    const cacheIdentity = {
        scanKey: "security_scan",
        files: filePaths,
        revision,
        scanConfig: {
            analysisProfile: config.analysisProfile,
            maxFiles: config.maxFiles,
            aiAssist: config.aiAssist,
            aiMaxFiles: config.aiMaxFiles,
            confidenceThreshold: config.confidenceThreshold,
            includePatterns: config.includePatterns,
            excludePatterns: config.excludePatterns,
            selectedPaths: config.selectedPaths ? Array.from(config.selectedPaths).sort() : null,
            verificationContextVersion: "supabase-policy-v1",
            adjudicationMode: config.aiEnabled ? "gemini-web-v1" : "off",
        },
        engineVersion: config.engineVersion,
        cacheKeyVersion: config.cacheKeyVersion,
    };

    const cachedResult = await getCachedSecurityScanResult(owner, repo, cacheIdentity) as SecurityScanCoreResult | null;
    const isCacheHit = Boolean(cachedResult);

    let result: SecurityScanCoreResult;
    if (cachedResult) {
        console.log(`🧠 Security Scan Cache Hit: ${owner}/${repo}`);
        result = {
            ...cachedResult,
            hiddenFindings: cachedResult.hiddenFindings ?? [],
            rejectedFindings: cachedResult.rejectedFindings ?? [],
            verificationRecords: cachedResult.verificationRecords ?? [],
            meta: {
                ...cachedResult.meta,
                fromCache: true,
                verifierStats: cachedResult.meta?.verifierStats ?? {
                    detected: cachedResult.summary?.total ?? cachedResult.findings?.length ?? 0,
                    verifiedTrue: cachedResult.findings?.length ?? 0,
                    rejectedFalse: 0,
                    inconclusiveHidden: 0,
                    canaryApplied: true,
                    verificationGateEnabled: false,
                    verifiedOnlyReportsEnabled: false,
                },
            },
        };
    } else {
        if (config.analysisProfile === "deep" && limitKey) {
            const currentScans = await kv.get<number>(limitKey) || 0;
            if (currentScans >= DEEP_SCAN_MONTHLY_LIMIT) {
                throw new Error(`Monthly Deep Scan limit reached (${DEEP_SCAN_MONTHLY_LIMIT}/${DEEP_SCAN_MONTHLY_LIMIT}).`);
            }
        }

        result = await runSecurityScan(owner, repo, files, config);

        // Cache the full core result object for 7 days.
        await cacheSecurityScanResult(owner, repo, cacheIdentity, result);
    }

    // Deep quota counts only fresh deep scans (cache hits do not consume quota).
    if (config.analysisProfile === "deep" && limitKey && !isCacheHit) {
        await kv.incr(limitKey);
        // Expire key after 32 days to clean up
        await kv.expire(limitKey, 32 * 24 * 60 * 60);
    }

    let scanId: string | undefined;
    try {
        const session = await auth();
        const userId = session?.user?.id;

        if (userId) {
            console.log(`📡 Saving scan ${result.meta.depth} for user ${userId}: ${owner}/${repo}`);
        } else {
            console.warn(`Anonymous scan performed for ${owner}/${repo} - will not be listed in user dashboard.`);
        }

        scanId = await saveScanResult(owner, repo, {
            depth: result.meta.depth,
            summary: result.summary,
            findings: result.findings,
        }, userId);

        if (scanId && result.verificationRecords.length > 0) {
            await saveScanFindingVerificationRecords({
                scanId,
                owner,
                repo,
                records: result.verificationRecords,
            });
        }
    } catch (e) {
        console.error("Failed to save scan to KV:", e);
    }

    return {
        ...result,
        scanId,
    };
}

export async function getRemainingDeepScans(): Promise<{ used: number; total: number; resetsAt: string; isUnlimited: boolean }> {
    const session = await auth();
    const total = DEEP_SCAN_MONTHLY_LIMIT;
    const now = new Date();
    // Default to end of current month
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const resetsAt = nextMonth.toISOString();

    if (!session?.user?.id) {
        return { used: 0, total, resetsAt, isUnlimited: false };
    }

    if (isAdminUser(session)) {
        return { used: 0, total, resetsAt, isUnlimited: true };
    }

    const monthKey = `${now.getFullYear()}_${now.getMonth() + 1}`;
    const limitKey = `user:${session.user.id}:deep_scans:${monthKey}`;

    const currentScans = await kv.get<number>(limitKey) || 0;

    return { used: currentScans, total, resetsAt, isUnlimited: false };
}

export async function getLatestRepoScanId(owner: string, repo: string): Promise<string | null> {
    return getLatestScanId(owner, repo);
}

export async function createScanShareLink(scanId: string, ttlDays: number = 7) {
    const { session, userId } = await requireAuthenticatedActor();
    const scanResult = await getScanResultWithStatus(scanId);
    if (scanResult.status === "not_found") {
        throw new Error("Scan not found");
    }
    if (scanResult.status === "expired") {
        throw new Error("Report expired. Run a new scan.");
    }
    const scan = scanResult.scan;

    if (!canAccessPrivateReport(session, scan)) {
        throw new Error("Forbidden");
    }

    const link = await createScanShareLinkRecord({
        scanId,
        createdByUserId: userId ?? null,
        canonicalExpiresAt: new Date(scan.expiresAt),
        ttlDays,
    });

    return {
        linkId: link.linkId,
        url: `${getPublicSiteUrl()}/report/shared/${link.token}`,
        expiresAt: link.expiresAt.toISOString(),
        createdAt: link.createdAt.toISOString(),
    };
}

export async function resolveScanFromShareToken(token: string) {
    return resolveScanFromShareTokenRecord(token);
}

export async function generateOutreachPack(scanId: string, ttlDays: number = 7) {
    const { session, userId } = await requireAuthenticatedActor();
    if (!isAdminUser(session)) {
        throw new Error("Forbidden");
    }

    const scanResult = await getScanResultWithStatus(scanId);
    if (scanResult.status === "not_found") {
        throw new Error("Scan not found");
    }
    if (scanResult.status === "expired") {
        throw new Error("Report expired. Run a new scan.");
    }
    const scan = scanResult.scan;

    if (!canAccessPrivateReport(session, scan)) {
        throw new Error("Forbidden");
    }

    const link = await createScanShareLinkRecord({
        scanId,
        createdByUserId: userId ?? null,
        canonicalExpiresAt: new Date(scan.expiresAt),
        ttlDays,
    });
    const shareUrl = `${getPublicSiteUrl()}/report/shared/${link.token}`;
    const outreach = buildOutreachPack(scan, shareUrl);

    return {
        ...outreach,
        linkId: link.linkId,
        expiresAt: link.expiresAt.toISOString(),
    };
}

export async function submitReportFalsePositive(input: {
    scanId: string;
    findingIndex: number;
    findingFingerprint: string;
    isSharedView: boolean;
    reason: ReportFalsePositiveReason;
    details: string;
}) {
    const session = await auth();
    const userId = getSessionUserId(session);
    const scanResult = await getScanResultWithStatus(input.scanId);

    if (scanResult.status === "not_found") {
        throw new Error("Scan not found");
    }

    const scan = scanResult.scan;
    if (!input.isSharedView && !canAccessPrivateReport(session, scan)) {
        throw new Error("Forbidden");
    }

    const finding = scan.findings[input.findingIndex];
    if (!finding) {
        throw new Error("Finding not found");
    }

    const fingerprint = buildFindingFingerprint(finding);
    if (fingerprint !== input.findingFingerprint) {
        throw new Error("Finding fingerprint mismatch");
    }
    if (!FALSE_POSITIVE_REASONS.has(input.reason)) {
        throw new Error("Invalid false positive reason");
    }
    const details = input.details.trim();
    if (!details) {
        throw new Error("Please include details for the false positive report");
    }

    await createFalsePositiveSubmission({
        scanId: scan.id,
        owner: scan.owner,
        repo: scan.repo,
        findingFingerprint: fingerprint,
        findingIndex: input.findingIndex,
        title: finding.title,
        severity: finding.severity,
        type: finding.type,
        file: finding.file,
        line: finding.line,
        confidence: finding.confidence,
        reason: input.reason,
        details,
        isSharedView: input.isSharedView,
        submittedByUserId: userId ?? null,
    });

    await trackReportConversionEvent("report_false_positive_flagged", scan.id, {
        actorUsername: session?.user?.username ?? null,
    });

    return { ok: true };
}

const FALSE_POSITIVE_STATUSES = new Set([
    "PENDING",
    "CONFIRMED_FALSE_POSITIVE",
    "REJECTED",
] as const);

export async function updateReportFalsePositiveReviewStatus(input: {
    submissionId: string;
    status: "PENDING" | "CONFIRMED_FALSE_POSITIVE" | "REJECTED";
}) {
    const { session, userId } = await requireAuthenticatedActor();
    if (!isAdminUser(session)) {
        throw new Error("Forbidden");
    }
    if (!FALSE_POSITIVE_STATUSES.has(input.status)) {
        throw new Error("Invalid status");
    }

    return updateFalsePositiveStatus({
        submissionId: input.submissionId,
        status: input.status,
        reviewedByUserId: userId ?? null,
    });
}

export async function startFindingFixVerification(input: {
    scanId?: string;
    findingFingerprint: string;
    changedFiles: string[];
}) {
    const session = await auth();
    const userId = getSessionUserId(session);

    return startFixVerificationRun(
        input.findingFingerprint,
        input.changedFiles,
        {
            scanId: input.scanId,
            requestedByUserId: userId ?? null,
        }
    );
}

export async function finalizeFindingFixVerification(input: {
    runId: string;
}) {
    return finalizeFixVerificationRun(input.runId);
}

export async function resetAdminReportFunnel() {
    const { session } = await requireAuthenticatedActor();
    if (!isAdminUser(session)) {
        throw new Error("Forbidden");
    }

    await resetReportConversionMetrics();

    return { ok: true };
}

export async function deleteLoggedInUserAccount(input: { userId: string }) {
    const { session } = await requireAuthenticatedActor();
    if (!isAdminUser(session)) {
        throw new Error("Forbidden");
    }

    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: {
            id: true,
            email: true,
            githubLogin: true,
        },
    });

    if (!user) {
        throw new Error("User not found");
    }
    if (user.email) {
        throw new Error("Only incomplete accounts can be deleted here");
    }
    if (user.githubLogin && user.githubLogin === session.user.username) {
        throw new Error("Cannot delete the configured admin account");
    }

    await prisma.user.delete({
        where: { id: input.userId },
    });

    return { ok: true, deletedUserId: input.userId };
}



// ─── Public Actions — Code Analysis & Artifact Generation ───────────────────

export async function searchRepositoryCode(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    query: string,
    type: "text" | "regex" | "ast" = "text"
): Promise<SearchResult[]> {
    return _searchRepositoryCode(owner, repo, files, query, type);
}

export async function getRecentSearches() {
    const session = await auth();
    if (!session?.user?.id) return [];
    return _getRecentSearches(session.user.id);
}
