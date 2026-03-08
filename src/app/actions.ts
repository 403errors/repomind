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
import { auth } from "@/lib/auth";
import { kv } from "@vercel/kv";
import {
    getProfile,
    getRepo,
    getDefaultBranchHeadSha,
    getRepoFileTree,
    getFileContent,
    getFileContentBatch,
    getProfileReadme,
    getUserRepos,
    getRepoReadme,
} from "@/lib/github";
import {
    trackEvent,
    getPublicStats,
    trackReportConversionEvent,
    type ReportConversionEvent,
} from "@/lib/analytics";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { SecurityFinding, ScanSummary } from "@/lib/security-scanner";
import type { SearchResult } from "@/lib/search-engine";
import { getCachedSecurityScanResult, cacheSecurityScanResult } from "@/lib/cache";
import type { ModelPreference } from "@/lib/ai-client";

// ─── Services & Domain ────────────────────────────────────────────────────────
import {
    executeRepoQuery,
    executeRepoQueryStream,
} from "@/lib/services/query-pipeline";
import {
    buildScanConfig,
    runSecurityScan,
    extractSnippet,
    type SecurityScanDeps,
} from "@/lib/services/security-service";
import {
    saveScanResult,
    getLatestScanId,
} from "@/lib/services/scan-storage";
import { recordSearch, getRecentSearches as _getRecentSearches } from "@/lib/services/history-service";
import {
    searchRepositoryCode as _searchRepositoryCode,
} from "@/lib/services/artifact-service";
import {
    toProfileContext,
    buildProfileContextString,
    buildRepoReadmeEntry,
    type RepoReadmeSummary,
} from "@/lib/domain";
import { answerWithContext, answerWithContextStream } from "@/lib/gemini";
import { mapProfileStreamChunk } from "@/lib/profile-stream";

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return String(error);
}

// ─── Private: Analytics tracking ─────────────────────────────────────────────

/**
 * Fire-and-forget analytics event.
 * Reads headers at this function's top level (required by Next.js 15).
 */
async function trackQueryEvent(visitorId: string | undefined): Promise<void> {
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

// ─── Private: Profile context ─────────────────────────────────────────────────

interface ProfileQueryInput {
    username: string;
    profile: GitHubProfile;
    profileReadme: string | null;
    repoReadmes: RepoReadmeSummary[];
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

    return context || `No profile data found for ${input.username}.`;
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

export async function fetchProfile(username: string) {
    return getProfile(username);
}

export async function fetchPublicStats() {
    return getPublicStats();
}

export async function trackReportConversion(event: ReportConversionEvent, scanId?: string) {
    await trackReportConversionEvent(event, scanId);
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
    history: { role: "user" | "model"; content: string }[] = [],
    profileData?: GitHubProfile,
    modelPreference: ModelPreference = "flash"
): AsyncGenerator<StreamUpdate> {
    yield* executeRepoQueryStream({
        query,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        filePaths,
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
    const ctx = toProfileContext(profileContext.profile);
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
    modelPreference: ModelPreference = "flash"
): AsyncGenerator<StreamUpdate> {
    const isThinking = modelPreference === "thinking";
    try {
        yield {
            type: "status",
            message: isThinking
                ? `Reasoning: Analyzing ${profileContext.username}'s GitHub profile and repository data...`
                : "Loading profile data...",
            progress: 20
        };

        const context = await buildFullProfileContext(
            profileContext,
            query,
            (msg) => { /* progress updates are fire-and-forget in this path */ }
        );

        yield {
            type: "status",
            message: isThinking
                ? `Process: Formulating insights based on profile, repositories, and your query — "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"...`
                : "Thinking & checking real-time data...",
            progress: 75
        };

        const ctx = toProfileContext(profileContext.profile);
        const stream = answerWithContextStream(
            query,
            context,
            { owner: profileContext.username, repo: "profile" },
            profileContext.profile,
            [],
            modelPreference
        );

        for await (const chunk of stream) {
            yield mapProfileStreamChunk(chunk);
        }

        yield { type: "complete", relevantFiles: [] };
    } catch (error: unknown) {
        console.error("Profile stream error:", error);
        yield { type: "error", message: getErrorMessage(error) || "An error occurred" };
    }
}

// ─── Public Actions — Security Scanning ──────────────────────────────────────

export interface SecurityScanOptions {
    includePatterns?: string[];
    excludePatterns?: string[];
    maxFiles?: number;
    depth?: "quick" | "deep";
    enableAi?: boolean;
    aiMaxFiles?: number;
    filePaths?: string[];
}

type SecurityScanResult = {
    findings: SecurityFinding[];
    summary: ScanSummary & { debug?: Record<string, number> };
    grouped: Record<string, SecurityFinding[]>;
    meta: { depth: "quick" | "deep"; aiEnabled: boolean; maxFiles: number; aiFilesSelected: number; durationMs: number };
    scanId?: string;
};

export async function scanRepositoryVulnerabilities(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    options: SecurityScanOptions = {}
): Promise<SecurityScanResult> {
    const config = buildScanConfig(options);
    const filePaths = files.map(f => f.path);

    const session = await auth();
    let limitKey = "";

    if (config.depth === "deep") {
        if (!session?.user?.id) {
            throw new Error("Authentication required for Deep Scan.");
        }
        const now = new Date();
        const monthKey = `${now.getFullYear()}_${now.getMonth() + 1}`;
        limitKey = `user:${session.user.id}:deep_scans:${monthKey}`;

        const currentScans = await kv.get<number>(limitKey) || 0;
        if (currentScans >= 5) {
            throw new Error("Monthly Deep Scan limit reached (5/5).");
        }
    }

    // Check cache first using commit-aware keying
    const cacheKey = `security_scan_${config.depth}_${config.aiEnabled}`;
    let revision = "unknown";
    try {
        revision = await getDefaultBranchHeadSha(owner, repo);
    } catch {
        console.warn(`Failed to resolve latest default-branch SHA for ${owner}/${repo}; using fallback revision key.`);
    }
    const cachedResult = await getCachedSecurityScanResult(owner, repo, cacheKey, filePaths, revision) as SecurityScanResult | null;

    if (cachedResult) {
        console.log(`🧠 AI Response Cache Hit for Security Scan: ${owner}/${repo}`);
        return cachedResult;
    }

    const result = await runSecurityScan(owner, repo, files, config);

    // Cache the full result object for 1 hour, keyed by current default-branch head SHA
    await cacheSecurityScanResult(owner, repo, cacheKey, filePaths, revision, result);

    if (config.depth === "deep" && limitKey) {
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
    } catch (e) {
        console.error("Failed to save scan to KV:", e);
    }

    return {
        ...result,
        scanId,
    };
}

export async function getRemainingDeepScans(): Promise<{ used: number; total: number; resetsAt: string }> {
    const session = await auth();
    const total = 5;
    const now = new Date();
    // Default to end of current month
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const resetsAt = nextMonth.toISOString();

    if (!session?.user?.id) {
        return { used: 0, total, resetsAt };
    }

    const monthKey = `${now.getFullYear()}_${now.getMonth() + 1}`;
    const limitKey = `user:${session.user.id}:deep_scans:${monthKey}`;

    const currentScans = await kv.get<number>(limitKey) || 0;

    return { used: currentScans, total, resetsAt };
}

export async function getLatestRepoScanId(owner: string, repo: string): Promise<string | null> {
    return getLatestScanId(owner, repo);
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
