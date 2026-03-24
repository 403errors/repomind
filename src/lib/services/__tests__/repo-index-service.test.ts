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
});
