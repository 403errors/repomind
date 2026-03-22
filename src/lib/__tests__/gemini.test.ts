import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    getGenAIMock,
    getGenerativeModelMock,
    buildRepoMindPromptMock,
    buildRepoMindVisualPromptMock,
    formatHistoryTextMock,
    getCachedQuerySelectionMock,
    cacheQuerySelectionMock,
    getRecentRepoCommitsSnapshotMock,
    getRecentProfileCommitsSnapshotMock,
    getUserReposMock,
    getUserReposByAgeMock,
    getRepoReleasesSnapshotMock,
    getProfileReleasesSnapshotMock,
    getRepoPullRequestsSnapshotMock,
    getProfilePullRequestsSnapshotMock,
    getRepoIssuesSnapshotMock,
    getProfileIssuesSnapshotMock,
    getRepoCommitFrequencySnapshotMock,
    getProfileCommitFrequencySnapshotMock,
    getRepoContributorsSnapshotMock,
    getProfileContributorsSnapshotMock,
    getRepoFileHistorySnapshotMock,
    compareRepoRefsSnapshotMock,
    getRepoWorkflowRunsSnapshotMock,
    getRepoLanguagesSnapshotMock,
    getRepoDependencyAlertsSnapshotMock,
} = vi.hoisted(() => ({
    getGenAIMock: vi.fn(),
    getGenerativeModelMock: vi.fn(),
    buildRepoMindPromptMock: vi.fn(),
    buildRepoMindVisualPromptMock: vi.fn(),
    formatHistoryTextMock: vi.fn(),
    getCachedQuerySelectionMock: vi.fn(),
    cacheQuerySelectionMock: vi.fn(),
    getRecentRepoCommitsSnapshotMock: vi.fn(),
    getRecentProfileCommitsSnapshotMock: vi.fn(),
    getUserReposMock: vi.fn(),
    getUserReposByAgeMock: vi.fn(),
    getRepoReleasesSnapshotMock: vi.fn(),
    getProfileReleasesSnapshotMock: vi.fn(),
    getRepoPullRequestsSnapshotMock: vi.fn(),
    getProfilePullRequestsSnapshotMock: vi.fn(),
    getRepoIssuesSnapshotMock: vi.fn(),
    getProfileIssuesSnapshotMock: vi.fn(),
    getRepoCommitFrequencySnapshotMock: vi.fn(),
    getProfileCommitFrequencySnapshotMock: vi.fn(),
    getRepoContributorsSnapshotMock: vi.fn(),
    getProfileContributorsSnapshotMock: vi.fn(),
    getRepoFileHistorySnapshotMock: vi.fn(),
    compareRepoRefsSnapshotMock: vi.fn(),
    getRepoWorkflowRunsSnapshotMock: vi.fn(),
    getRepoLanguagesSnapshotMock: vi.fn(),
    getRepoDependencyAlertsSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/ai-client", () => ({
    getGenAI: getGenAIMock,
    DEFAULT_MODEL: "gemini-3-flash-preview",
    FILE_SELECTOR_MODEL: "gemini-3.1-flash-lite-preview",
    getChatModelForPreference: vi.fn(() => "gemini-3-flash-preview"),
}));

vi.mock("@/lib/prompt-builder", () => ({
    buildRepoMindPrompt: buildRepoMindPromptMock,
    buildRepoMindVisualPrompt: buildRepoMindVisualPromptMock,
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
    getRepoReleasesSnapshot: getRepoReleasesSnapshotMock,
    getProfileReleasesSnapshot: getProfileReleasesSnapshotMock,
    getRepoPullRequestsSnapshot: getRepoPullRequestsSnapshotMock,
    getProfilePullRequestsSnapshot: getProfilePullRequestsSnapshotMock,
    getRepoIssuesSnapshot: getRepoIssuesSnapshotMock,
    getProfileIssuesSnapshot: getProfileIssuesSnapshotMock,
    getRepoCommitFrequencySnapshot: getRepoCommitFrequencySnapshotMock,
    getProfileCommitFrequencySnapshot: getProfileCommitFrequencySnapshotMock,
    getRepoContributorsSnapshot: getRepoContributorsSnapshotMock,
    getProfileContributorsSnapshot: getProfileContributorsSnapshotMock,
    getRepoFileHistorySnapshot: getRepoFileHistorySnapshotMock,
    compareRepoRefsSnapshot: compareRepoRefsSnapshotMock,
    getRepoWorkflowRunsSnapshot: getRepoWorkflowRunsSnapshotMock,
    getRepoLanguagesSnapshot: getRepoLanguagesSnapshotMock,
    getRepoDependencyAlertsSnapshot: getRepoDependencyAlertsSnapshotMock,
}));

import { analyzeFileSelection, answerWithContextStream, fixMermaidSyntax } from "@/lib/gemini";

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
        buildRepoMindVisualPromptMock.mockReset();
        formatHistoryTextMock.mockReset();
        getRecentRepoCommitsSnapshotMock.mockReset();
        getRecentProfileCommitsSnapshotMock.mockReset();
        getUserReposMock.mockReset();
        getUserReposByAgeMock.mockReset();
        getRepoReleasesSnapshotMock.mockReset();
        getProfileReleasesSnapshotMock.mockReset();
        getRepoPullRequestsSnapshotMock.mockReset();
        getProfilePullRequestsSnapshotMock.mockReset();
        getRepoIssuesSnapshotMock.mockReset();
        getProfileIssuesSnapshotMock.mockReset();
        getRepoCommitFrequencySnapshotMock.mockReset();
        getProfileCommitFrequencySnapshotMock.mockReset();
        getRepoContributorsSnapshotMock.mockReset();
        getProfileContributorsSnapshotMock.mockReset();
        getRepoFileHistorySnapshotMock.mockReset();
        compareRepoRefsSnapshotMock.mockReset();
        getRepoWorkflowRunsSnapshotMock.mockReset();
        getRepoLanguagesSnapshotMock.mockReset();
        getRepoDependencyAlertsSnapshotMock.mockReset();

        buildRepoMindPromptMock.mockReturnValue("prompt");
        buildRepoMindVisualPromptMock.mockReturnValue("visual-prompt");
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

    it("strips emoji characters from streamed answer chunks", async () => {
        const sendMessageStreamMock = vi.fn().mockResolvedValue({
            stream: toAsyncStream([
                {
                    candidates: [{ content: { parts: [{ text: "Final answer 🚀" }] } }],
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

        expect(chunks).toContain("Final answer ");
    });

    it("uses visual-only prompt builder when query has visual intent", async () => {
        const sendMessageStreamMock = vi.fn().mockResolvedValue({
            stream: toAsyncStream([
                {
                    candidates: [{ content: { parts: [{ text: "diagram" }] } }],
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

        for await (const chunk of answerWithContextStream(
            "Create a flowchart of the build pipeline",
            "repo context",
            { owner: "acme", repo: "widget" }
        )) {
            void chunk;
        }

        expect(buildRepoMindVisualPromptMock).toHaveBeenCalledTimes(1);
        expect(buildRepoMindPromptMock).not.toHaveBeenCalled();
        expect(buildRepoMindVisualPromptMock).toHaveBeenCalledWith(
            expect.objectContaining({
                question: "Create a flowchart of the build pipeline",
                context: "repo context",
                repoDetails: { owner: "acme", repo: "widget" },
                historyText: "history",
            })
        );
    });

    it("disables function tools when disableFunctionTools is true", async () => {
        const sendMessageStreamMock = vi.fn().mockResolvedValue({
            stream: toAsyncStream([
                {
                    candidates: [{ content: { parts: [{ text: "No-tool answer" }] } }],
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
            { owner: "acme", repo: "widget" },
            undefined,
            [],
            "flash",
            true
        )) {
            chunks.push(chunk);
        }

        expect(getGenerativeModelMock).toHaveBeenCalledWith(expect.objectContaining({
            tools: [],
        }));
        expect(chunks).toContain("STATUS:Tool calls are paused for this window. Continuing without repository tools.");
        expect(chunks).toContain("No-tool answer");
    });

    it("reuses the same chat session for tool follow-up so thought signatures stay intact", async () => {
        getRecentRepoCommitsSnapshotMock.mockResolvedValue({
            success: true,
            data: {
                commits: [{ sha: "abc123", message: "feat: test", date: "2026-03-17T00:00:00Z" }],
                freshness: { label: "just now" },
            },
        });

        const sendMessageStreamMock = vi.fn()
            .mockResolvedValueOnce({
                stream: toAsyncStream([
                    {
                        functionCalls: () => [{ name: "fetch_recent_commits", args: { limit: 1 } }],
                        candidates: [{ content: { parts: [] } }],
                    },
                ]),
                response: Promise.resolve({
                    functionCalls: () => [{ name: "fetch_recent_commits", args: { limit: 1 } }],
                    candidates: [{
                        content: {
                            parts: [
                                {
                                    functionCall: { name: "fetch_recent_commits", args: { limit: 1 } },
                                    thoughtSignature: "sig-123",
                                },
                            ],
                        },
                    }],
                }),
            })
            .mockResolvedValueOnce({
                stream: toAsyncStream([
                    {
                        candidates: [{ content: { parts: [{ text: "Final answer" }] } }],
                    },
                ]),
                response: Promise.resolve({
                    functionCalls: () => [],
                }),
            });

        const startChatMock = vi.fn().mockReturnValue({
            sendMessageStream: sendMessageStreamMock,
        });

        getGenerativeModelMock.mockReturnValue({
            startChat: startChatMock,
        });

        const chunks: string[] = [];
        for await (const chunk of answerWithContextStream(
            "Summarize recent commits",
            "repo context",
            { owner: "acme", repo: "widget" }
        )) {
            chunks.push(chunk);
        }

        expect(startChatMock).toHaveBeenCalledTimes(1);
        expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
        expect(sendMessageStreamMock).toHaveBeenNthCalledWith(2, [
            {
                functionResponse: {
                    name: "fetch_recent_commits",
                    response: {
                        name: "fetch_recent_commits",
                        content: {
                            commits: [{ sha: "abc123", message: "feat: test", date: "2026-03-17T00:00:00Z" }],
                            scope: "repository",
                            repository: "widget",
                            limitExceeded: false,
                            maxAllowed: 10,
                            githubCallPolicy: {
                                functionName: "fetch_recent_commits",
                                maxConsecutiveCalls: 2,
                                callsUsed: 1,
                                limitedByCap: false,
                                note: undefined,
                                sampledRepositories: ["acme/widget"],
                            },
                        },
                    },
                },
            },
        ]);
        const toolEvents = chunks
            .filter((chunk) => chunk.startsWith("TOOL:"))
            .map((chunk) => JSON.parse(chunk.replace("TOOL:", "")) as { name?: string; billable?: boolean });
        expect(toolEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "fetch_recent_commits", billable: false }),
                expect.objectContaining({ name: "fetch_recent_commits", billable: true }),
            ])
        );
        expect(chunks).toContain("Final answer");
    });

    it("caps profile-overall tool fetches to two GitHub calls and returns transparency metadata", async () => {
        getUserReposMock.mockResolvedValue([
            { name: "repo-one" },
            { name: "repo-two" },
        ]);
        getRepoPullRequestsSnapshotMock.mockResolvedValue({
            success: true,
            data: [{ repo: "repo-one", number: 1, title: "PR", state: "open", draft: false, created_at: "2026-03-17T00:00:00Z", updated_at: "2026-03-17T00:00:00Z", merged_at: null, html_url: "https://example.com/pr/1", author: "alice" }],
        });

        const sendMessageStreamMock = vi.fn()
            .mockResolvedValueOnce({
                stream: toAsyncStream([
                    {
                        functionCalls: () => [{ name: "fetch_pull_requests", args: { state: "all", limit: 5 } }],
                        candidates: [{ content: { parts: [] } }],
                    },
                ]),
                response: Promise.resolve({
                    functionCalls: () => [{ name: "fetch_pull_requests", args: { state: "all", limit: 5 } }],
                    candidates: [{ content: { parts: [] } }],
                }),
            })
            .mockResolvedValueOnce({
                stream: toAsyncStream([
                    {
                        candidates: [{ content: { parts: [{ text: "Final answer" }] } }],
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

        for await (const chunk of answerWithContextStream(
            "Show overall PR activity",
            "profile context",
            { owner: "acme", repo: "profile" }
        )) {
            void chunk;
        }

        expect(getUserReposMock).toHaveBeenCalledWith("acme");
        expect(getRepoPullRequestsSnapshotMock).toHaveBeenCalledTimes(1);
        expect(getRepoPullRequestsSnapshotMock).toHaveBeenCalledWith("acme", "repo-one", "all", 5, undefined);

        const secondCallArgs = sendMessageStreamMock.mock.calls[1][0];
        const content = secondCallArgs[0]?.functionResponse?.response?.content;
        expect(content.githubCallPolicy).toMatchObject({
            functionName: "fetch_pull_requests",
            maxConsecutiveCalls: 2,
            callsUsed: 2,
            limitedByCap: true,
            sampledRepositories: ["acme/repo-one"],
        });
        expect(typeof content.githubCallPolicy.note).toBe("string");
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

describe("fixMermaidSyntax", () => {
    beforeEach(() => {
        getGenAIMock.mockReset();
        getGenerativeModelMock.mockReset();

        getGenAIMock.mockReturnValue({
            getGenerativeModel: getGenerativeModelMock,
        });
    });

    it("uses classDiagram-specific instructions when fixing class diagrams", async () => {
        const generateContentMock = vi.fn().mockResolvedValue({
            response: {
                text: () => "```mermaid\nclassDiagram\n  class Repository\n```",
            },
        });

        getGenerativeModelMock.mockReturnValue({
            generateContent: generateContentMock,
        });

        const fixed = await fixMermaidSyntax(`classDiagram
  class Repository
  class FileSelector
  class ChatService
  Repository --> FileSelector`, {
            syntaxError: "Parse error on line 4",
            diagramType: "classDiagram",
        });

        expect(fixed).toContain("classDiagram");
        expect(generateContentMock).toHaveBeenCalledTimes(1);

        const prompt = String(generateContentMock.mock.calls[0]?.[0] ?? "");
        expect(prompt).toContain("Target diagram type: classDiagram");
        expect(prompt).toContain("PARSER ERROR CONTEXT:\nParse error on line 4");
        expect(prompt).toContain("Do NOT convert this into flowchart node syntax");
        expect(prompt).toContain("TYPE-SPECIFIC CANONICAL EXAMPLE");
        expect(prompt).not.toContain("First line must be `sequenceDiagram`.");
    });
});
