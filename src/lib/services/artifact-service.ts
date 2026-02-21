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
import { searchFiles, type SearchResult, type SearchOptions } from "@/lib/search-engine";

// ─── Injectable Deps ──────────────────────────────────────────────────────────

export interface ArtifactServiceDeps {
    fetchContent?: (owner: string, repo: string, path: string) => Promise<string>;
}

// ─── Service Functions ────────────────────────────────────────────────────────

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


