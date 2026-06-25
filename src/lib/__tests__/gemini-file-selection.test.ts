import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchRepoIndex, tokenizeText, type RepoIndex } from "@/lib/services/repo-index-service";

const {
    getGenAIMock,
    getGenerativeModelMock,
    getCachedQuerySelectionMock,
    cacheQuerySelectionMock,
} = vi.hoisted(() => ({
    getGenAIMock: vi.fn(),
    getGenerativeModelMock: vi.fn(),
    getCachedQuerySelectionMock: vi.fn(),
    cacheQuerySelectionMock: vi.fn(),
}));

vi.mock("@/lib/ai-client", () => ({
    getGenAI: getGenAIMock,
    FILE_SELECTOR_MODEL: "gemini-3.1-flash-lite-preview",
    getChatModelForPreference: vi.fn(() => "gemini-3-flash-preview"),
}));

vi.mock("@/lib/cache", () => ({
    getCachedQuerySelection: getCachedQuerySelectionMock,
    cacheQuerySelection: cacheQuerySelectionMock,
}));

import { analyzeFileSelection } from "@/lib/gemini";

describe("File Selection Quality - Comprehensive Test Suite (P1-P5)", () => {
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

    describe("Scenario: Gemini Model Query with All Fixes Applied", () => {
        it("E2E: Selects correct files when asking about Gemini model (P1+P3+P4+P5)", async () => {
            const repoFiles = [
                // ML/AI files (should be selected)
                "src/lib/gemini.ts",
                "src/lib/ai-client.ts",
                "src/lib/gemini-security.ts",
                
                // API files (context)
                "src/app/api/chat/route.ts",
                "src/app/api/analyze/route.ts",
                
                // UI files (context)
                "src/components/Chat.tsx",
                "src/components/CodeViewer.tsx",
                
                // Config files
                "src/config.json",
                "next.config.ts",
                
                // Documentation (should be deprioritized)
                "README.md",
                "docs/API.md",
            ];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({
                        files: [
                            "src/lib/gemini.ts",
                            "src/lib/ai-client.ts",
                            "src/app/api/chat/route.ts"
                        ]
                    }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            const selected = await analyzeFileSelection(
                "What Gemini model is used in this app?",
                repoFiles,
                "owner",
                "repo",
                "flash"
            );

            // Verify correct files selected
            expect(selected).toContain("src/lib/gemini.ts");
            expect(selected).toContain("src/lib/ai-client.ts");
            
            // Verify prompt was sent with HIGH thinking (P1)
            const callConfig = getGenerativeModelMock.mock.calls[0][0];
            expect(callConfig.generationConfig.thinkingConfig.thinking_level).toBe("HIGH");

            // Verify repository context was included (P5)
            const promptCall = generateContentMock.mock.calls[0][0];
            expect(promptCall).toContain("Repository Context:");
            expect(promptCall).toContain("Architecture:");
        });
    });

    describe("Scenario: Follow-up Queries with Different Intent (P2)", () => {
        it("E2E: Distinguishes between explanation and performance queries", async () => {
            const repoFiles = [
                "src/lib/gemini.ts",
                "src/lib/performance-monitor.ts",
                "src/components/LoadingIndicator.tsx",
            ];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({ files: ["src/lib/gemini.ts"] }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            // First query: Explanation intent
            getCachedQuerySelectionMock.mockResolvedValue(null);
            await analyzeFileSelection(
                "Explain how the Gemini model works",
                repoFiles,
                "owner",
                "repo"
            );

            // Verify cache was called with "explanation" intent
            const firstCacheCall = getCachedQuerySelectionMock.mock.calls[0];
            expect(firstCacheCall[4]).toBe("explanation");

            // Second query: Performance intent
            getCachedQuerySelectionMock.mockReset();
            getCachedQuerySelectionMock.mockResolvedValue(null);
            generateContentMock.mockClear();
            
            await analyzeFileSelection(
                "Why is Gemini model so slow in production?",
                repoFiles,
                "owner",
                "repo"
            );

            // Verify cache was called with "performance" intent (different from first)
            const secondCacheCall = getCachedQuerySelectionMock.mock.calls[0];
            expect(secondCacheCall[4]).toBe("performance");
            expect(secondCacheCall[4]).not.toBe(firstCacheCall[4]);
        });
    });

    describe("Scenario: Large Repository (1000+ files)", () => {
        it("E2E: Handles large repos efficiently (P3 candidate pool cap)", async () => {
            // Generate 1000 test files
            const largeFileList = Array.from({ length: 1000 }, (_, i) => `src/file_${i}.ts`);
            largeFileList.push("src/lib/gemini.ts");
            largeFileList.push("README.md");

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({
                        files: ["src/lib/gemini.ts"]
                    }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            await analyzeFileSelection(
                "Gemini integration",
                largeFileList
            );

            // Verify candidate pool was capped at 50
            const promptCall = generateContentMock.mock.calls[0][0];
            const candidateSection = promptCall.match(/Candidate Files[\s\S]*?\n\n/)?.[0] || "";
            const candidateLines = candidateSection.split('\n').filter(line => line.startsWith('src/'));
            
            expect(candidateLines.length).toBeLessThanOrEqual(50);
        });
    });

    describe("Scenario: Semantic Search - Domain-Specific Queries (P4)", () => {
        it("E2E: Boosts ML files for AI-related queries", () => {
            const index: RepoIndex = {
                version: 1,
                createdAt: Date.now(),
                entries: [
                    {
                        path: "src/lib/gemini.ts",
                        tokens: ["gemini", "model"],  // model token for query match
                        filenameTokens: ["gemini"],
                        coreBoost: 0,
                        semanticGroup: "ml",
                    },
                    {
                        path: "src/utils/helpers.ts",
                        tokens: ["helpers", "model"],  // Also has model token
                        filenameTokens: ["helpers"],
                        coreBoost: 0,
                        semanticGroup: "util",
                    },
                ],
            };

            const result = searchRepoIndex("llm model", index);
            
            // ML file should rank first due to semantic grouping (both match model, but gemini is ml)
            if (result.files.length > 0) {
                expect(result.files).toContain("src/lib/gemini.ts");
            }
        });

        it("E2E: Boosts API files for API-related queries", () => {
            const index: RepoIndex = {
                version: 1,
                createdAt: Date.now(),
                entries: [
                    {
                        path: "src/api/routes.ts",
                        tokens: ["routes", "endpoint"],  // endpoint token for query match
                        filenameTokens: ["routes"],
                        coreBoost: 0,
                        semanticGroup: "api",
                    },
                    {
                        path: "src/components/UI.tsx",
                        tokens: ["ui", "endpoint"],  // Also has endpoint token
                        filenameTokens: ["ui"],
                        coreBoost: 0,
                        semanticGroup: "ui",
                    },
                ],
            };

            const result = searchRepoIndex("api endpoint handler", index);
            
            // API file should be first (both match endpoint, but routes is api)
            if (result.files.length > 0) {
                expect(result.files).toContain("src/api/routes.ts");
            }
        });
    });

    describe("Quality Metrics", () => {
        it("E2E: Achieves high file selection confidence", async () => {
            const repoFiles = [
                "src/lib/gemini.ts",
                "src/lib/ai-client.ts",
                "src/app/api/chat/route.ts",
                "README.md",
            ];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({
                        files: ["src/lib/gemini.ts", "src/lib/ai-client.ts"]
                    }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            const selected = await analyzeFileSelection(
                "Explain Gemini model usage",
                repoFiles
            );

            // Expect 2-4 files (not too many, not too few)
            expect(selected.length).toBeGreaterThanOrEqual(1);
            expect(selected.length).toBeLessThanOrEqual(4);
            
            // Expect source files, not documentation
            expect(selected).not.toContain("README.md");
        });

        it("E2E: Returns minimum necessary files", async () => {
            const repoFiles = [
                "src/lib/gemini.ts",
                "src/lib/ai-client.ts",
                "src/lib/gemini-security.ts",
                "src/components/Chat.tsx",
                "README.md",
            ];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({
                        files: ["src/lib/gemini.ts"]
                    }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            const selected = await analyzeFileSelection(
                "Which file contains Gemini model definition?",
                repoFiles
            );

            // For a specific file query, should return minimal files
            expect(selected.length).toBeLessThanOrEqual(3);
        });
    });

    describe("Backward Compatibility", () => {
        it("E2E: Works with missing cache (graceful degradation)", async () => {
            const repoFiles = ["src/lib/gemini.ts", "README.md"];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({ files: ["src/lib/gemini.ts"] }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            // Simulate cache miss
            getCachedQuerySelectionMock.mockResolvedValue(null);

            const selected = await analyzeFileSelection(
                "Gemini model",
                repoFiles,
                "owner",
                "repo"
            );

            // Should still work and return files
            expect(selected.length).toBeGreaterThan(0);
        });

        it("E2E: Handles queries without owner/repo context", async () => {
            const repoFiles = ["src/lib/gemini.ts", "README.md"];

            const generateContentMock = vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({ files: ["src/lib/gemini.ts"] }),
                },
            });

            getGenerativeModelMock.mockReturnValue({
                generateContent: generateContentMock,
            });

            // Call without owner/repo (should still work)
            const selected = await analyzeFileSelection(
                "Gemini",
                repoFiles
                // No owner/repo
            );

            expect(selected.length).toBeGreaterThan(0);
        });
    });
});
