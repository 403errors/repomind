import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRepoQuery, executeRepoQueryStream } from "@/lib/services/query-pipeline";
import type { StreamUpdate } from "@/lib/streaming-types";

const {
    getCachedRepoQueryAnswerMock,
    cacheRepoQueryAnswerMock,
    getLatestRepoQueryAnswerMock,
} = vi.hoisted(() => ({
    getCachedRepoQueryAnswerMock: vi.fn(),
    cacheRepoQueryAnswerMock: vi.fn(),
    getLatestRepoQueryAnswerMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
    getCachedRepoQueryAnswer: getCachedRepoQueryAnswerMock,
    cacheRepoQueryAnswer: cacheRepoQueryAnswerMock,
    getLatestRepoQueryAnswer: getLatestRepoQueryAnswerMock,
}));

vi.mock("@/lib/gemini", () => ({
    analyzeFileSelection: vi.fn(),
    answerWithContextStream: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
    getFileContentBatch: vi.fn(),
}));

describe("executeRepoQueryStream", () => {
    beforeEach(() => {
        getCachedRepoQueryAnswerMock.mockReset();
        cacheRepoQueryAnswerMock.mockReset();
        getLatestRepoQueryAnswerMock.mockReset();
    });

    it("short-circuits when a latest cached answer exists", async () => {
        getLatestRepoQueryAnswerMock.mockResolvedValue("recent answer");

        const updates: StreamUpdate[] = [];
        for await (const update of executeRepoQueryStream({
            query: "what does this repo do?",
            owner: "acme",
            repo: "widget",
            filePaths: ["src/index.ts"],
        })) {
            updates.push(update);
        }

        expect(updates).toEqual([
            { type: "content", text: "recent answer", append: true },
            { type: "complete", relevantFiles: [] },
        ]);
    });
});

describe("executeRepoQuery", () => {
    beforeEach(() => {
        getCachedRepoQueryAnswerMock.mockReset();
        cacheRepoQueryAnswerMock.mockReset();
        getLatestRepoQueryAnswerMock.mockReset();
    });

    it("returns cached answer when selected-file cache hit exists", async () => {
        getLatestRepoQueryAnswerMock.mockResolvedValue(null);
        getCachedRepoQueryAnswerMock.mockResolvedValue("cached-by-selection");

        const analyzeFiles = vi.fn().mockResolvedValue(["src/index.ts"]);

        const result = await executeRepoQuery(
            {
                query: "explain architecture",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/index.ts", "public/logo.png"],
            },
            { analyzeFiles }
        );

        expect(result).toEqual({
            answer: "cached-by-selection",
            relevantFiles: ["src/index.ts"],
        });
        expect(cacheRepoQueryAnswerMock).not.toHaveBeenCalled();
    });

    it("streams and caches a fresh answer when no cache hit exists", async () => {
        getLatestRepoQueryAnswerMock.mockResolvedValue(null);
        getCachedRepoQueryAnswerMock.mockResolvedValue(null);

        const analyzeFiles = vi.fn().mockResolvedValue(["src/core.ts"]);
        const fetchFiles = vi.fn().mockResolvedValue([
            { path: "src/core.ts", content: "export const value = 1;" },
        ]);
        const streamAnswer = async function* () {
            yield "First ";
            yield "Second";
        };

        const result = await executeRepoQuery(
            {
                query: "summarize core logic",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/core.ts"],
            },
            { analyzeFiles, fetchFiles, streamAnswer }
        );

        expect(result).toEqual({
            answer: "First Second",
            relevantFiles: ["src/core.ts"],
        });
        expect(cacheRepoQueryAnswerMock).toHaveBeenCalledWith(
            "acme",
            "widget",
            "summarize core logic",
            ["src/core.ts"],
            "First Second"
        );
    });
});
