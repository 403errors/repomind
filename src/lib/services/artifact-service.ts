/**
 * Artifact generation service — A1
 *
 * Extracted from actions.ts. All code quality analysis, search, and
 * AI artifact generation lives here. Actions.ts becomes a thin adapter.
 *
 * Each function accepts injectable deps for testing.
 */
import { getFileContent } from "@/lib/github";
import { countTokens } from "@/lib/tokens";
import { analyzeCodeQuality, type QualityReport } from "@/lib/quality-analyzer";
import { searchFiles, type SearchResult, type SearchOptions } from "@/lib/search-engine";
import {
    generateDocumentation,
    generateTests,
    suggestRefactoring,
} from "@/lib/generator";

/** Max token budget for single-file analysis/generation tasks */
const ARTIFACT_TOKEN_LIMIT = 5_000;

// ─── Injectable Deps ──────────────────────────────────────────────────────────

export interface ArtifactServiceDeps {
    fetchContent?: (owner: string, repo: string, path: string) => Promise<string>;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Analyse the code quality of a single file.
 * Returns null on failure — callers should treat null as "unavailable".
 */
export async function analyzeFileQuality(
    owner: string,
    repo: string,
    path: string,
    deps: ArtifactServiceDeps = {}
): Promise<QualityReport | null> {
    const fetchContent = deps.fetchContent ?? getFileContent;
    try {
        const content = await fetchContent(owner, repo, path);
        if (countTokens(content) > ARTIFACT_TOKEN_LIMIT) {
            throw new Error(`File too large for quality analysis (exceeds ${ARTIFACT_TOKEN_LIMIT} tokens)`);
        }
        return await analyzeCodeQuality(content, path);
    } catch (error) {
        console.error("Quality analysis failed:", error);
        return null;
    }
}

/**
 * Search file contents across a repository.
 * Accepts only JS/TS files for AST search; skips non-parseable files silently.
 */
export async function searchRepositoryCode(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    query: string,
    type: SearchOptions["type"] = "text",
    deps: ArtifactServiceDeps = {}
): Promise<SearchResult[]> {
    const fetchContent = deps.fetchContent ?? getFileContent;
    try {
        const candidateFiles = files.slice(0, 50);
        const filesWithContent: Array<{ path: string; content: string }> = [];

        for (const file of candidateFiles) {
            if (type === "ast" && !/\.(js|jsx|ts|tsx)$/.test(file.path)) continue;
            try {
                const content = await fetchContent(owner, repo, file.path);
                filesWithContent.push({ path: file.path, content });
            } catch {
                // Skip files that fail to fetch — don't abort the whole search
            }
        }

        return searchFiles(filesWithContent, { query, type });
    } catch (error) {
        console.error("Repository search failed:", error);
        return [];
    }
}

export type ArtifactType = "doc" | "test" | "refactor";

/**
 * Generate a code artifact (JSDoc, unit tests, or refactor suggestions)
 * for a single file.
 */
export async function generateFileArtifact(
    owner: string,
    repo: string,
    path: string,
    type: ArtifactType,
    deps: ArtifactServiceDeps = {}
): Promise<string> {
    const fetchContent = deps.fetchContent ?? getFileContent;
    try {
        const content = await fetchContent(owner, repo, path);
        if (countTokens(content) > ARTIFACT_TOKEN_LIMIT) {
            return `Error: File too large for generation (exceeds ${ARTIFACT_TOKEN_LIMIT} tokens)`;
        }

        switch (type) {
            case "doc":
                return await generateDocumentation(content);
            case "test":
                return await generateTests(content);
            case "refactor":
                return await suggestRefactoring(content);
            default: {
                const _exhaustive: never = type;
                return `Invalid artifact type: ${_exhaustive}`;
            }
        }
    } catch {
        return "Failed to generate artifact";
    }
}
