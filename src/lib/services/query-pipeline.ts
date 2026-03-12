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
import { getFileContentBatch } from "@/lib/github";
import { countTokens, MAX_TOKENS } from "@/lib/tokens";
import { getCachedRepoQueryAnswer, cacheRepoQueryAnswer, getLatestRepoQueryAnswer } from "@/lib/cache";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { ModelPreference } from "@/lib/ai-client";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RepoQueryParams {
    query: string;
    owner: string;
    repo: string;
    filePaths: string[];
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
        history?: { role: "user" | "model"; content: string }[]
    ) => Promise<string[]>;

    /** Fetches file content in batch — defaults to GitHub API */
    fetchFiles?: (
        owner: string,
        repo: string,
        files: Array<{ path: string; sha?: string }>
    ) => Promise<Array<{ path: string; content: string | null }>>;

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
        fetchFiles = (owner, repo, files) => getFileContentBatch(owner, repo, files),
        streamAnswer = answerWithContextStream,
    } = deps;

    const { query, owner, repo, filePaths, history = [], profileData, modelPreference } = params;

    try {
        const isThinking = modelPreference === "thinking";

        // Step 0: Short-circuit check
        // Check if we have ANY recent answer for this exact query in this repo.
        // This bypasses file selection, fetching, and AI generation entirely (0.1s hit).
        const shortCircuit = await getLatestRepoQueryAnswer(owner, repo, query);
        if (shortCircuit) {
            console.log(`🚀 Short-Circuit Cache Hit: ${owner}/${repo} -> ${query}`);
            yield { type: "content", text: shortCircuit, append: true };
            yield { type: "complete", relevantFiles: [] }; // In short-circuit we don't know the files, or we could cache them too.
            return;
        }

        // Step 1: Select relevant files
        yield {
            type: "status",
            message: isThinking
                ? `Reasoning: Identifying files relevant to "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"...`
                : "Analyzing repository structure...",
            progress: 15
        };

        const prunedPaths = pruneFilePaths(filePaths);
        const relevantFiles = await analyzeFiles(query, prunedPaths, owner, repo, modelPreference, history);

        yield { type: "files", files: relevantFiles };
        yield {
            type: "status",
            message: isThinking
                ? `Process: Loading ${relevantFiles.length} file${relevantFiles.length !== 1 ? 's' : ''} for context analysis...`
                : "Reading selected files...",
            progress: 40
        };

        // Step 2: Fetch file content with token budget
        const fileResults = await fetchFiles(
            owner,
            repo,
            relevantFiles.map((path) => ({ path }))
        );

        let context = "";
        let tokenTotal = 0;

        for (const { path, content } of fileResults) {
            if (!content) continue;
            const tokens = countTokens(content);
            if (tokenTotal + tokens > MAX_TOKENS) {
                context += `\n--- NOTE: Context truncated at ${MAX_TOKENS.toLocaleString()} token limit ---\n`;
                break;
            }
            context += `\n--- FILE: ${path} ---\n${content}\n`;
            tokenTotal += tokens;
        }

        if (!context) {
            context = "No file content could be retrieved for the selected files.";
        }

        // Step 3: Stream AI response
        yield {
            type: "status",
            message: isThinking
                ? "Process: Formulating a detailed response based on the code context..."
                : "Thinking...",
            progress: 70
        };

        const stream = streamAnswer(
            query,
            context,
            { owner, repo },
            profileData,
            history,
            modelPreference
        );

        for await (const chunk of stream) {
            if (chunk.startsWith("THOUGHT:")) {
                yield { type: "thought", text: chunk.replace("THOUGHT:", "") };
            } else {
                yield { type: "content", text: chunk, append: true };
            }
        }

        yield { type: "complete", relevantFiles };
    } catch (error: unknown) {
        console.error("Query pipeline error:", {
            owner,
            repo,
            modelPreference: modelPreference ?? "flash",
            filePathCount: filePaths.length,
            queryPreview: query.slice(0, 160),
            error,
        });
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        yield { type: "error", message };
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
    const selectedFiles = await analyzeFiles(params.query, prunedPaths, params.owner, params.repo, params.modelPreference, params.history);
    const cached = await getCachedRepoQueryAnswer(params.owner, params.repo, params.query, selectedFiles);

    if (cached) {
        console.log(`🧠 AI Response Cache Hit for ${params.owner}/${params.repo}: ${params.query}`);
        return { answer: cached, relevantFiles: selectedFiles };
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
        await cacheRepoQueryAnswer(params.owner, params.repo, params.query, relevantFiles, answer);
    }

    return { answer, relevantFiles };
}
