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
import {
    getProfile,
    getRepo,
    getRepoFileTree,
    getFileContent,
    getFileContentBatch,
    getProfileReadme,
    getUserRepos,
    getRepoReadme,
} from "@/lib/github";
import { trackEvent, getPublicStats } from "@/lib/analytics";
import { generateSecurityPatch } from "@/lib/gemini-security";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { SecurityFinding, ScanSummary } from "@/lib/security-scanner";
import type { SearchResult } from "@/lib/search-engine";
import { getCachedRepoQueryAnswer, cacheRepoQueryAnswer } from "@/lib/cache";

// ─── Services & Domain ────────────────────────────────────────────────────────
import {
    executeRepoQuery,
    executeRepoQueryStream,
    type RepoQueryParams,
} from "@/lib/services/query-pipeline";
import {
    buildScanConfig,
    runSecurityScan,
    extractSnippet,
    type SecurityScanDeps,
} from "@/lib/services/security-service";
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

// ─── Private: Analytics tracking ─────────────────────────────────────────────

/**
 * Fire-and-forget analytics event.
 * Reads headers at this function's top level (required by Next.js 15).
 */
async function trackQueryEvent(visitorId: string | undefined): Promise<void> {
    if (process.env.NODE_ENV === "development") {
        console.log("[Analytics] Skipped (dev)");
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

    for (const readme of input.repoReadmes) {
        let content = readme.content;
        if (!content && query.toLowerCase().includes(readme.repo.toLowerCase())) {
            onProgress?.(`Reading ${readme.repo}...`);
            content = (await getRepoReadme(input.username, readme.repo)) ?? "";
        }
        context += buildRepoReadmeEntry({ ...readme, content });
    }

    return context || `No profile data found for ${input.username}.`;
}

// ─── Public Actions — Data Fetching ──────────────────────────────────────────

export async function fetchGitHubData(input: string) {
    const parts = input.split("/");
    if (parts.length === 1) {
        try {
            return { type: "profile", data: await getProfile(parts[0]) };
        } catch (e: any) {
            return { error: `User not found: ${e.message ?? e}` };
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
            return { type: "repo", data: repoData, fileTree: tree, hiddenFiles };
        } catch (e: any) {
            return { error: `Repository not found: ${e.message ?? e}` };
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
    repo?: string
): Promise<{ relevantFiles: string[]; fileCount: number }> {
    // Delegate file-selection step only — the pipeline handles full execution
    const fakeParams: RepoQueryParams = {
        query,
        owner: owner ?? "",
        repo: repo ?? "",
        filePaths,
    };

    // For backwards compatibility (some callers only want the file list),
    // we run the selection step directly from gemini rather than the full pipeline
    const { analyzeFileSelection } = await import("@/lib/gemini");
    const SKIP = /\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css)$/i;
    const pruned = filePaths.filter(
        (p) => !SKIP.test(p) && !p.includes("node_modules/") && !p.includes(".git/")
    );
    const relevantFiles = await analyzeFileSelection(query, pruned, owner, repo);
    return { relevantFiles, fileCount: relevantFiles.length };
}

/**
 * Step 2+3 combined: fetch files + generate answer (non-streaming).
 * Thin adapter — delegates entirely to the query pipeline.
 */
export async function generateAnswer(
    query: string,
    context: string,   // kept for backwards-compat; pipeline re-fetches internally
    repoDetails: { owner: string; repo: string },
    history: { role: "user" | "model"; content: string }[] = [],
    profileData?: GitHubProfile,
    visitorId?: string,
    filePaths?: string[]
): Promise<string> {
    await trackQueryEvent(visitorId);

    if (!filePaths?.length) {
        // Fallback: if no file paths, answer with the pre-built context
        return answerWithContext(query, context, repoDetails, profileData, history);
    }

    const { answer } = await executeRepoQuery({
        query,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        filePaths,
        history,
        profileData,
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
    profileData?: GitHubProfile
): AsyncGenerator<StreamUpdate> {
    yield* executeRepoQueryStream({
        query,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        filePaths,
        history,
        profileData,
    });
}

// ─── Public Actions — Profile Mode ───────────────────────────────────────────

export async function processProfileQuery(
    query: string,
    profileContext: ProfileQueryInput,
    visitorId?: string,
    history: { role: "user" | "model"; content: string }[] = []
) {
    await trackQueryEvent(visitorId);
    const context = await buildFullProfileContext(profileContext, query);
    const ctx = toProfileContext(profileContext.profile);
    const answer = await answerWithContext(
        query,
        context,
        { owner: profileContext.username, repo: "profile" },
        profileContext.profile,
        history
    );
    return { answer };
}

export async function* processProfileQueryStream(
    query: string,
    profileContext: ProfileQueryInput
): AsyncGenerator<StreamUpdate> {
    try {
        yield { type: "status", message: "Loading profile data...", progress: 20 };

        const context = await buildFullProfileContext(
            profileContext,
            query,
            (msg) => { /* progress updates are fire-and-forget in this path */ }
        );

        yield { type: "status", message: "Thinking & checking real-time data...", progress: 75 };

        const ctx = toProfileContext(profileContext.profile);
        const stream = answerWithContextStream(
            query,
            context,
            { owner: profileContext.username, repo: "profile" },
            profileContext.profile
        );

        for await (const chunk of stream) {
            yield { type: "content", text: chunk, append: true };
        }

        yield { type: "complete", relevantFiles: [] };
    } catch (error: any) {
        console.error("Profile stream error:", error);
        yield { type: "error", message: error?.message ?? "An error occurred" };
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

export async function scanRepositoryVulnerabilities(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    options: SecurityScanOptions = {}
): Promise<{
    findings: SecurityFinding[];
    summary: ScanSummary & { debug?: Record<string, number> };
    grouped: Record<string, SecurityFinding[]>;
    meta: { depth: "quick" | "deep"; aiEnabled: boolean; maxFiles: number; aiFilesSelected: number; durationMs: number };
}> {
    const config = buildScanConfig(options);
    const filePaths = files.map(f => f.path);

    // Check cache first using a unique query string identifier
    const cacheKey = `security_scan_${config.depth}_${config.aiEnabled}`;
    const cachedResult = await getCachedRepoQueryAnswer(owner, repo, cacheKey, filePaths) as any;

    if (cachedResult) {
        console.log(`🧠 AI Response Cache Hit for Security Scan: ${owner}/${repo}`);
        return cachedResult;
    }

    const result = await runSecurityScan(owner, repo, files, config);

    // Cache the full result object for 24 hours
    await cacheRepoQueryAnswer(owner, repo, cacheKey, filePaths, result);

    return result;
}

export async function generateSecurityPatchForFinding(
    owner: string,
    repo: string,
    finding: SecurityFinding
): Promise<{ patch: string; explanation: string }> {
    try {
        const content = await getFileContent(owner, repo, finding.file);
        const snippet = typeof content === "string" ? extractSnippet(content, finding.line) : "";
        return await generateSecurityPatch({
            filePath: finding.file,
            fileContent: typeof content === "string" ? content : "",
            line: finding.line,
            description: finding.description,
            recommendation: finding.recommendation,
            snippet,
        });
    } catch (error: any) {
        console.error("Security patch generation failed:", error);
        return { patch: "", explanation: "Failed to generate patch." };
    }
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
