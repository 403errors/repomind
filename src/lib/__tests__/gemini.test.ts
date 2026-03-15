import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    getGenAIMock,
    getGenerativeModelMock,
    buildRepoMindPromptMock,
    formatHistoryTextMock,
    getCachedQuerySelectionMock,
    cacheQuerySelectionMock,
    getRecentRepoCommitsSnapshotMock,
    getRecentProfileCommitsSnapshotMock,
    getUserReposMock,
    getUserReposByAgeMock,
} = vi.hoisted(() => ({
    getGenAIMock: vi.fn(),
    getGenerativeModelMock: vi.fn(),
    buildRepoMindPromptMock: vi.fn(),
    formatHistoryTextMock: vi.fn(),
    getCachedQuerySelectionMock: vi.fn(),
    cacheQuerySelectionMock: vi.fn(),
    getRecentRepoCommitsSnapshotMock: vi.fn(),
    getRecentProfileCommitsSnapshotMock: vi.fn(),
    getUserReposMock: vi.fn(),
    getUserReposByAgeMock: vi.fn(),
}));

vi.mock("@/lib/ai-client", () => ({
    getGenAI: getGenAIMock,
    DEFAULT_MODEL: "gemini-3-flash-preview",
    FILE_SELECTOR_MODEL: "gemini-3.1-flash-lite-preview",
    getChatModelForPreference: vi.fn(() => "gemini-3-flash-preview"),
}));

vi.mock("@/lib/prompt-builder", () => ({
    buildRepoMindPrompt: buildRepoMindPromptMock,
    formatHistoryText: formatHistoryTextMock,
}));

vi.mock("@/lib/cache", () => ({
    getCachedQuerySelection: getCachedQuerySelectionMock,
    cacheQuerySelection: cacheQuerySelectionMock,
}));

vi.mock("@/lib/github", () => ({
    getRecentRepoCommitsSnapshot: getRecentRepoCommitsSnapshotMock,
    getRecentProfileCommitsSnapshot: getRecentProfileCommitsSnapshotMock,
    getUserRepos: getUserReposMock,
    getUserReposByAge: getUserReposByAgeMock,
}));

import { analyzeFileSelection, answerWithContextStream } from "@/lib/gemini";

function toAsyncStream<T>(items: T[]): AsyncIterable<T> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of items) {
                yield item;
            }
        },
    };
}

describe("answerWithContextStream", () => {
    beforeEach(() => {
        getGenAIMock.mockReset();
        getGenerativeModelMock.mockReset();
        buildRepoMindPromptMock.mockReset();
        formatHistoryTextMock.mockReset();
        getRecentRepoCommitsSnapshotMock.mockReset();
        getRecentProfileCommitsSnapshotMock.mockReset();
        getUserReposMock.mockReset();
        getUserReposByAgeMock.mockReset();

        buildRepoMindPromptMock.mockReturnValue("prompt");
        formatHistoryTextMock.mockReturnValue("history");

        getGenAIMock.mockReturnValue({
            getGenerativeModel: getGenerativeModelMock,
        });
    });

    it("does not send a function response when stream-only function calls disappear in finalized response", async () => {
        const sendMessageStreamMock = vi.fn().mockResolvedValue({
            stream: toAsyncStream([
                {
                    functionCalls: () => [{ name: "fetch_recent_commits", args: { limit: 5 } }],
                    candidates: [{ content: { parts: [{ text: "Interim reasoning..." }] } }],
                },
            ]),
            response: Promise.resolve({
                functionCalls: () => [],
            }),
        });

        getGenerativeModelMock.mockReturnValue({
            startChat: () => ({
                sendMessageStream: sendMessageStreamMock,
            }),
        });

        const chunks: string[] = [];
        for await (const chunk of answerWithContextStream(
            "Summarize recent activity",
            "repo context",
            { owner: "acme", repo: "widget" }
        )) {
            chunks.push(chunk);
        }

        expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
        expect(chunks).toContain("Interim reasoning...");
    });
});

describe("analyzeFileSelection", () => {
    beforeEach(() => {
        getGenAIMock.mockReset();
        getGenerativeModelMock.mockReset();
        getCachedQuerySelectionMock.mockReset();
        cacheQuerySelectionMock.mockReset();

        getCachedQuerySelectionMock.mockResolvedValue(null);
        getGenAIMock.mockReturnValue({
            getGenerativeModel: getGenerativeModelMock,
        });
    });

    it("extracts JSON file selections from mixed prose responses", async () => {
        const generateContentMock = vi.fn().mockResolvedValue({
            response: {
                text: () =>
                    [
                        "**Analyzing the request**",
                        "{\"files\":[\"src/core.ts\",\"README.md\"]}",
                        "Using these files for context.",
                    ].join("\n"),
            },
        });

        getGenerativeModelMock.mockReturnValue({
            generateContent: generateContentMock,
        });

        const selected = await analyzeFileSelection(
            "Try again",
            ["src/core.ts", "README.md", "docs/notes.md"]
        );

        expect(selected).toEqual(["src/core.ts", "README.md"]);
    });
});
