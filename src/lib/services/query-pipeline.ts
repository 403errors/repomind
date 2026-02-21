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
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RepoQueryParams {
    query: string;
    owner: string;
    repo: string;
    filePaths: string[];
    history?: { role: "user" | "model"; content: string }[];
    profileData?: GitHubProfile;
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
        repo: string
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
        history?: { role: "user" | "model"; content: string }[]
    ) => AsyncGenerator<string>;
}

// ─── File Pruning ──────────────────────────────────────────────────────────────

/** Binary/generated files that add noise without value for AI analysis */
const SKIP_PATTERN =
    /\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css)$/i;

function pruneFilePaths(paths: string[]): string[] {
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

    const { query, owner, repo, filePaths, history = [], profileData } = params;

    try {
        // Step 1: Select relevant files
        yield { type: "status", message: "Analyzing repository structure...", progress: 15 };

        const prunedPaths = pruneFilePaths(filePaths);
        const relevantFiles = await analyzeFiles(query, prunedPaths, owner, repo);

        yield { type: "files", files: relevantFiles };
        yield { type: "status", message: "Reading selected files...", progress: 40 };

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
        yield { type: "status", message: "Thinking...", progress: 70 };

        const stream = streamAnswer(
            query,
            context,
            { owner, repo },
            profileData,
            history
        );

        for await (const chunk of stream) {
            yield { type: "content", text: chunk, append: true };
        }

        yield { type: "complete", relevantFiles };
    } catch (error: any) {
        console.error("Query pipeline error:", error);
        yield { type: "error", message: error?.message ?? "An unexpected error occurred" };
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

    for await (const update of executeRepoQueryStream(params, deps)) {
        if (update.type === "content") {
            answer += update.text;
        } else if (update.type === "complete") {
            relevantFiles = update.relevantFiles;
        } else if (update.type === "error") {
            throw new Error(update.message);
        }
    }

    return { answer, relevantFiles };
}
