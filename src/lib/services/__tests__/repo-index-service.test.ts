import { describe, expect, it } from "vitest";
import { searchRepoIndex, tokenizeText, type RepoIndex } from "@/lib/services/repo-index-service";

describe("repo-index-service", () => {
    it("tokenizes paths and filenames", () => {
        expect(tokenizeText("src/utils/ApiClient.ts")).toEqual([
            "src",
            "utils",
            "api",
            "client",
            "ts",
        ]);
    });

    it("ranks files with stronger token matches higher", () => {
        const index: RepoIndex = {
            version: 1,
            createdAt: 0,
            entries: [
                {
                    path: "src/index.ts",
                    tokens: tokenizeText("src/index.ts"),
                    filenameTokens: tokenizeText("index.ts"),
                    coreBoost: 2,
                },
                {
                    path: "docs/README.md",
                    tokens: tokenizeText("docs/README.md"),
                    filenameTokens: tokenizeText("README.md"),
                    coreBoost: 0,
                },
            ],
        };

        const result = searchRepoIndex("index entry", index);
        expect(result.files[0]).toBe("src/index.ts");
        expect(result.bestScore).toBeGreaterThanOrEqual(result.scoreThreshold);
    });

    it("[P4] applies semantic grouping boost for ML/AI queries", () => {
        const index: RepoIndex = {
            version: 1,
            createdAt: 0,
            entries: [
                {
                    path: "src/lib/gemini.ts",
                    tokens: ["gemini", "model", "llm"],  // Include matching tokens
                    filenameTokens: ["gemini"],
                    coreBoost: 0,
                    semanticGroup: "ml",  // ML domain
                },
                {
                    path: "src/utils/helpers.ts",
                    tokens: ["helpers", "model"],  // Also has "model" but different domain
                    filenameTokens: ["helpers"],
                    coreBoost: 0,
                    semanticGroup: "util",  // Util domain
                },
            ],
        };

        // Query about LLM/AI should boost ML-grouped files
        const result = searchRepoIndex("llm model", index);
        
        // gemini.ts should be included and rank higher due to semantic grouping + llm match
        expect(result.files).toContain("src/lib/gemini.ts");
        if (result.files.length > 0 && result.files[0]) {
            // gemini should rank first (has "llm" + "model" tokens + ml semantic boost)
            expect(result.files[0]).toBe("src/lib/gemini.ts");
        }
    });

    it("[P4] boosts API files for API-related queries", () => {
        const index: RepoIndex = {
            version: 1,
            createdAt: 0,
            entries: [
                {
                    path: "src/api/routes.ts",
                    tokens: ["routes", "api", "endpoint"],  // Include matching tokens
                    filenameTokens: ["routes"],
                    coreBoost: 0,
                    semanticGroup: "api",
                },
                {
                    path: "src/components/Button.tsx",
                    tokens: ["button", "endpoint"],  // Also has endpoint but different domain
                    filenameTokens: ["button"],
                    coreBoost: 0,
                    semanticGroup: "ui",
                },
            ],
        };

        const result = searchRepoIndex("api routes", index);
        // Routes file should be included (has matching tokens)
        expect(result.files).toContain("src/api/routes.ts");
        if (result.files.length > 0 && result.files[0]) {
            // routes should rank first (has both "api" and "routes" tokens + api semantic boost)
            expect(result.files[0]).toBe("src/api/routes.ts");
        }
    });

    it("[P5] does not crash when index has no semantic groups", () => {
        // Test backward compatibility with old index entries without semanticGroup
        const index: RepoIndex = {
            version: 1,
            createdAt: 0,
            entries: [
                {
                    path: "src/index.ts",
                    tokens: tokenizeText("src/index.ts"),
                    filenameTokens: tokenizeText("index.ts"),
                    coreBoost: 2,
                    // No semanticGroup or contextHint
                },
            ],
        };

        const result = searchRepoIndex("index file", index);
        expect(result.files).toContain("src/index.ts");
        expect(result.bestScore).toBeGreaterThan(0);
    });
});
