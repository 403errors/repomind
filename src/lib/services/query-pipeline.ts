/**
 * Unified repository query pipeline — A1, A5, A6
 *
 * Single AsyncGenerator-based pipeline for all repo queries.
 * Both streaming and non-streaming callers run the SAME pipeline:
 *   1. File selection via AI
 *   2. File content fetching with token budget
 *   3. AI response generation (chunked)
 *
 * Accepts an optional `deps` object so unit tests can inject stub
 * implementations without mocking the environment or real API calls.
 */
import { analyzeFileSelection, answerWithContextStream } from "@/lib/gemini";
import { getFileContentBatch, getFileContentBatchWithStats, type FileBatchFetchStats } from "@/lib/github";
import { countTokens, MAX_TOKENS } from "@/lib/tokens";
import {
    getCachedRepoQueryAnswer,
    cacheRepoQueryAnswer,
    getLatestRepoQueryAnswer,
    resolveAnonymousConsecutivePaths,
} from "@/lib/cache";
import type { FileCachePolicy } from "@/lib/cache";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { ModelPreference } from "@/lib/ai-client";
import { stripEmojiCharacters } from "@/lib/no-emoji";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RepoQueryParams {
    query: string;
    owner: string;
    repo: string;
    filePaths: string[];
    fileShas?: Record<string, string>;
    fileCachePolicy?: FileCachePolicy;
    history?: { role: "user" | "model"; content: string }[];
    profileData?: GitHubProfile;
    modelPreference?: ModelPreference;
}

/**
 * Injectable dependencies for the query pipeline.
 * Each field defaults to the real implementation when omitted,
 * making this useful for tests (inject stubs) without affecting production.
 */
export interface QueryPipelineDeps {
    /** Selects relevant files for a query — defaults to AI-based selection */
    analyzeFiles?: (
        query: string,
        filePaths: string[],
        owner: string,
        repo: string,
        modelPreference?: ModelPreference,
        history?: { role: "user" | "model"; content: string }[],
        fileCachePolicy?: FileCachePolicy
    ) => Promise<string[]>;

    /** Fetches file content in batch — defaults to GitHub API */
    fetchFiles?: (
        owner: string,
        repo: string,
        files: Array<{ path: string; sha?: string }>,
        fileCachePolicy?: FileCachePolicy
    ) => Promise<Array<{ path: string; content: string | null }>>;

    fetchFilesWithStats?: (
        owner: string,
        repo: string,
        files: Array<{ path: string; sha?: string }>,
        fileCachePolicy?: FileCachePolicy
    ) => Promise<{ files: Array<{ path: string; content: string | null }>; stats: FileBatchFetchStats }>;

    /** Streams AI response — defaults to Gemini */
    streamAnswer?: (
        question: string,
        context: string,
        repoDetails: { owner: string; repo: string },
        profileData?: GitHubProfile,
        history?: { role: "user" | "model"; content: string }[],
        modelPreference?: ModelPreference
    ) => AsyncGenerator<string>;
}

function classifyPipelineError(error: unknown): { message: string; code?: string } {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    if (/function response turn comes immediately after a function call turn/i.test(message)) {
        return {
            message: "AI tool-call handoff failed while streaming. Please retry.",
            code: "AI_FUNCTION_TURN_ORDER",
        };
    }
    return { message };
}

// ─── File Pruning ──────────────────────────────────────────────────────────────

/** Binary/generated files that add noise without value for AI analysis */
const SKIP_PATTERN =
    /(\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css|woff|woff2|ttf|otf|eot)|package-lock\.json|yarn\.lock)$/i;

export function pruneFilePaths(paths: string[]): string[] {
    return paths.filter(
        (p) =>
            !SKIP_PATTERN.test(p) &&
            !p.includes("node_modules/") &&
            !p.includes(".git/")
    );
}

interface FolderNode {
    dirs: Map<string, FolderNode>;
    files: string[];
}

function createFolderNode(): FolderNode {
    return { dirs: new Map(), files: [] };
}

function buildRepoFolderStructure(paths: string[], maxPaths: number = 500, maxLines: number = 220): string {
    const root = createFolderNode();
    const limitedPaths = paths.slice(0, maxPaths);

    for (const rawPath of limitedPaths) {
        const parts = rawPath.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let node = root;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const segment = parts[i];
            let next = node.dirs.get(segment);
            if (!next) {
                next = createFolderNode();
                node.dirs.set(segment, next);
            }
            node = next;
        }
        node.files.push(parts[parts.length - 1]);
    }

    const lines: string[] = [];
    const render = (node: FolderNode, depth: number) => {
        const indent = "  ".repeat(depth);
        for (const dir of Array.from(node.dirs.keys()).sort()) {
            lines.push(`${indent}- ${dir}/`);
            if (lines.length >= maxLines) return;
            const child = node.dirs.get(dir);
            if (child) {
                render(child, depth + 1);
            }
            if (lines.length >= maxLines) return;
        }
        for (const file of [...node.files].sort()) {
            lines.push(`${indent}- ${file}`);
            if (lines.length >= maxLines) return;
        }
    };

    render(root, 0);

    if (paths.length > maxPaths || lines.length >= maxLines) {
        lines.push("- ... (folder structure truncated)");
    }

    if (lines.length === 0) {
        return "- (No repository files available)";
    }

    return lines.join("\n");
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Core repository query pipeline as a streaming generator.
 * Yields StreamUpdate events that consumers can forward directly to the client
 * or collect into a single response (see executeRepoQuery).
 */
export async function* executeRepoQueryStream(
    params: RepoQueryParams,
    deps: QueryPipelineDeps = {}
): AsyncGenerator<StreamUpdate> {
    const {
        analyzeFiles = analyzeFileSelection,
        fetchFiles = (owner, repo, files, fileCachePolicy) => getFileContentBatch(owner, repo, files, fileCachePolicy),
        fetchFilesWithStats,
        streamAnswer = answerWithContextStream,
    } = deps;

    const { query, owner, repo, filePaths, fileShas, fileCachePolicy, history = [], profileData, modelPreference } = params;

    try {
        const pipelineStartMs = Date.now();
        let selectionMs = 0;
        let fileFetchMs = 0;
        let contextBuildMs = 0;
        let answerMs = 0;

        // Step 0: Short-circuit check
        // Check if we have ANY recent answer for this exact query in this repo.
        // This bypasses file selection, fetching, and AI generation entirely (0.1s hit).
        const shortCircuit = await getLatestRepoQueryAnswer(owner, repo, query, fileCachePolicy);
        if (shortCircuit) {
            console.log(`[query-pipeline] Short-circuit cache hit: ${owner}/${repo} -> ${query}`);
            yield {
                type: "status",
                message: "Using cached answer...",
                progress: 95,
            };
            yield { type: "content", text: stripEmojiCharacters(shortCircuit), append: true };
            yield { type: "complete", relevantFiles: [] }; // In short-circuit we don't know the files, or we could cache them too.
            return;
        }

        // Step 1: Select relevant files
        yield {
            type: "status",
            message: "Selecting relevant files...",
            progress: 15,
        };

        const prunedPaths = pruneFilePaths(filePaths);
        const selectionStartMs = Date.now();
        const relevantFiles = await analyzeFiles(query, prunedPaths, owner, repo, modelPreference, history, fileCachePolicy);
        selectionMs = Date.now() - selectionStartMs;

        yield {
            type: "status",
            message: `Selection complete: ${filePaths.length.toLocaleString()} paths -> ${prunedPaths.length.toLocaleString()} candidates -> ${relevantFiles.length} selected.`,
            progress: 28,
        };

        yield { type: "files", files: relevantFiles };
        yield {
            type: "status",
            message: `Reading ${relevantFiles.length} selected file${relevantFiles.length !== 1 ? "s" : ""}...`,
            progress: 40,
        };

        // Step 2: Fetch file content with token budget
        let effectiveFileCachePolicy = fileCachePolicy;
        if (fileCachePolicy?.audience === "anonymous") {
            const consecutivePaths = await resolveAnonymousConsecutivePaths(
                owner,
                repo,
                relevantFiles,
                fileCachePolicy
            );
            effectiveFileCachePolicy = {
                ...fileCachePolicy,
                consecutivePaths,
            };
        }

        const fileTargets = relevantFiles.map((path) => {
            const sha = fileShas?.[path];
            return sha ? { path, sha } : { path };
        });
        const fetchStartMs = Date.now();
        let fileResults: Array<{ path: string; content: string | null }> = [];
        let fetchStats: FileBatchFetchStats | null = null;
        if (fetchFilesWithStats) {
            const fetched = await fetchFilesWithStats(owner, repo, fileTargets, effectiveFileCachePolicy);
            fileResults = fetched.files;
            fetchStats = fetched.stats;
        } else if (!deps.fetchFiles) {
            const fetched = await getFileContentBatchWithStats(owner, repo, fileTargets, effectiveFileCachePolicy);
            fileResults = fetched.files;
            fetchStats = fetched.stats;
        } else {
            fileResults = await fetchFiles(owner, repo, fileTargets, effectiveFileCachePolicy);
        }
        fileFetchMs = Date.now() - fetchStartMs;

        if (fetchStats) {
            yield {
                type: "status",
                message: `Cache hit ${fetchStats.cacheHits}/${fetchStats.requested}; fetched ${fetchStats.fetchedFromGitHub} from GitHub${fetchStats.failed > 0 ? ` (${fetchStats.failed} unavailable)` : ""}.`,
                progress: 55,
            };
        }

        const selectedFilesList = relevantFiles.length > 0
            ? relevantFiles.map((path) => `- ${path}`).join("\n")
            : "- (No specific files selected)";
        const folderStructure = buildRepoFolderStructure(prunedPaths);

        const contextBuildStartMs = Date.now();
        let context =
            `\n--- REPOSITORY FOLDER STRUCTURE ---\n${folderStructure}\n` +
            `\n--- SELECTED FILES ---\n${selectedFilesList}\n`;

        let tokenTotal = countTokens(context);
        let contextTruncated = false;

        for (const { path, content } of fileResults) {
            if (!content) continue;
            const tokens = countTokens(content);
            if (tokenTotal + tokens > MAX_TOKENS) {
                context += `\n--- NOTE: Context truncated at ${MAX_TOKENS.toLocaleString()} token limit ---\n`;
                contextTruncated = true;
                break;
            }
            context += `\n--- FILE: ${path} ---\n${content}\n`;
            tokenTotal += tokens;
        }
        contextBuildMs = Date.now() - contextBuildStartMs;

        if (contextTruncated) {
            yield {
                type: "status",
                message: `Context token budget reached (${MAX_TOKENS.toLocaleString()}); using highest-priority files only...`,
                progress: 65,
            };
        }

        if (!context) {
            context = "No file content could be retrieved for the selected files.";
        }

        // Step 3: Stream AI response
        yield {
            type: "status",
            message: "Preparing answer from selected context...",
            progress: 70,
        };

        yield {
            type: "status",
            message: "Preparing answer...",
            progress: 85,
        };

        const stream = streamAnswer(
            query,
            context,
            { owner, repo },
            profileData,
            history,
            modelPreference
        );
        const toolsUsed = new Set<string>();
        let commitFreshnessLabel: string | undefined;
        const answerStartMs = Date.now();

        for await (const chunk of stream) {
            if (chunk.startsWith("THOUGHT:")) {
                yield { type: "thought", text: chunk.replace("THOUGHT:", "") };
            } else if (chunk.startsWith("STATUS:")) {
                yield {
                    type: "status",
                    message: chunk.replace("STATUS:", "").trim(),
                    progress: 85,
                };
            } else if (chunk.startsWith("TOOL:")) {
                try {
                    const parsed = JSON.parse(chunk.replace("TOOL:", "").trim()) as {
                        name?: unknown;
                        detail?: unknown;
                        usageUnits?: unknown;
                    };
                    if (typeof parsed.name === "string") {
                        toolsUsed.add(parsed.name);
                        yield {
                            type: "tool",
                            name: parsed.name,
                            detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
                            usageUnits: typeof parsed.usageUnits === "number" ? parsed.usageUnits : undefined,
                        };
                    }
                } catch {
                    // Ignore malformed TOOL payloads.
                }
            } else if (chunk.startsWith("META:")) {
                try {
                    const parsed = JSON.parse(chunk.replace("META:", "").trim()) as {
                        commitFreshnessLabel?: unknown;
                    };
                    if (typeof parsed.commitFreshnessLabel === "string" && parsed.commitFreshnessLabel.trim().length > 0) {
                        commitFreshnessLabel = parsed.commitFreshnessLabel;
                    }
                } catch {
                    // Ignore malformed META payloads.
                }
            } else {
                yield { type: "content", text: stripEmojiCharacters(chunk), append: true };
            }
        }
        answerMs = Date.now() - answerStartMs;
        const sourceScope = toolsUsed.has("googleSearch")
            ? (toolsUsed.has("fetch_recent_commits") ? "Repository + commits + web snapshot" : "Repository + web snapshot")
            : (toolsUsed.has("fetch_recent_commits") ? "Repository + commits" : "Repository only");
        const processingSummary = [
            `Selection: ${selectionMs}ms`,
            `File fetch: ${fileFetchMs}ms`,
            `Context build: ${contextBuildMs}ms`,
            `Answer generation: ${answerMs}ms`,
            `Total: ${Date.now() - pipelineStartMs}ms`,
        ];

        yield {
            type: "complete",
            relevantFiles,
            metadata: {
                commitFreshnessLabel,
                toolsUsed: toolsUsed.size > 0 ? Array.from(toolsUsed) : undefined,
                processingSummary,
                sourceScope,
            },
        };
    } catch (error: unknown) {
        console.error("Query pipeline error:", {
            owner,
            repo,
            modelPreference: modelPreference ?? "flash",
            filePathCount: filePaths.length,
            queryPreview: query.slice(0, 160),
            error,
        });
        const classified = classifyPipelineError(error);
        yield { type: "error", message: classified.message, code: classified.code };
    }
}

/**
 * Non-streaming wrapper around executeRepoQueryStream.
 * Collects all chunks into a single string response.
 * Used by server actions that don't need incremental delivery.
 */
export async function executeRepoQuery(
    params: RepoQueryParams,
    deps: QueryPipelineDeps = {}
): Promise<{ answer: string; relevantFiles: string[] }> {
    let answer = "";
    let relevantFiles: string[] = [];

    // Attempt cache hit first
    const { analyzeFiles = analyzeFileSelection } = deps;
    const prunedPaths = pruneFilePaths(params.filePaths);
    const selectedFiles = await analyzeFiles(
        params.query,
        prunedPaths,
        params.owner,
        params.repo,
        params.modelPreference,
        params.history,
        params.fileCachePolicy
    );
    const cached = await getCachedRepoQueryAnswer(
        params.owner,
        params.repo,
        params.query,
        selectedFiles,
        params.fileCachePolicy
    );

    if (cached) {
        console.log(`[query-pipeline] AI response cache hit for ${params.owner}/${params.repo}: ${params.query}`);
        return { answer: stripEmojiCharacters(cached), relevantFiles: selectedFiles };
    }

    for await (const update of executeRepoQueryStream(params, deps)) {
        if (update.type === "content") {
            answer += update.text;
        } else if (update.type === "complete") {
            relevantFiles = update.relevantFiles;
        } else if (update.type === "error") {
            throw new Error(update.message);
        }
    }

    // Save to cache after complete response
    if (answer) {
        await cacheRepoQueryAnswer(
            params.owner,
            params.repo,
            params.query,
            relevantFiles,
            answer,
            params.fileCachePolicy
        );
    }

    return { answer, relevantFiles };
}
