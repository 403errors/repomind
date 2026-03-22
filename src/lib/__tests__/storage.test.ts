import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage mock ────────────────────────────────────────────────────────

const _store: Record<string, string> = {};

vi.stubGlobal("localStorage", {
    getItem(key: string): string | null { return _store[key] ?? null; },
    setItem(key: string, value: string): void { _store[key] = value; },
    removeItem(key: string): void { delete _store[key]; },
    clear(): void { Object.keys(_store).forEach(k => delete _store[k]); },
    get length(): number { return Object.keys(_store).length; },
    key(i: number): string | null { return Object.keys(_store)[i] ?? null; },
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mock axios so cloud storage calls don't throw
vi.mock("axios", () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: [] }),
        post: vi.fn().mockResolvedValue({ data: { success: true } }),
        delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    },
}));

import {
    formatStorageSize,
    getStorageSize,
    getAllConversationKeys,
    getStorageStats,
    saveConversation,
    loadConversation,
    clearConversation,
    loadProfileConversation,
} from "@/lib/storage";

beforeEach(() => {
    Object.keys(_store).forEach(k => delete _store[k]);
    vi.clearAllMocks();
    fetchMock.mockReset();
});

// ─── formatStorageSize ────────────────────────────────────────────────────────

describe("formatStorageSize", () => {
    it("formats as KB when under 1 MB", () => {
        const result = formatStorageSize(2048);
        expect(result).toContain("KB");
    });

    it("formats 1 KB correctly", () => {
        expect(formatStorageSize(1024)).toBe("1.0 KB");
    });

    it("formats megabytes", () => {
        expect(formatStorageSize(1024 * 1024)).toContain("MB");
    });
});

// ─── getStorageSize ───────────────────────────────────────────────────────────

describe("getStorageSize", () => {
    it("returns a non-negative number", () => {
        const size = getStorageSize();
        expect(size).toBeGreaterThanOrEqual(0);
    });

    it("increases after saving an item", async () => {
        const before = getStorageSize();
        await saveConversation("owner", "repo", [
            { id: "1", role: "user", content: "hello world" },
        ]);
        const after = getStorageSize();
        expect(after).toBeGreaterThan(before);
    });
});

// ─── getAllConversationKeys ────────────────────────────────────────────────────

describe("getAllConversationKeys", () => {
    it("returns empty array when nothing stored", () => {
        const keys = getAllConversationKeys();
        expect(Array.isArray(keys)).toBe(true);
    });

    it("returns a key after saving a conversation", async () => {
        await saveConversation("octocat", "testrepo", [
            { id: "1", role: "user", content: "test" },
        ]);
        const keys = getAllConversationKeys();
        expect(keys.length).toBeGreaterThan(0);
    });
});

// ─── saveConversation / loadConversation ──────────────────────────────────────

describe("saveConversation and loadConversation", () => {
    it("round-trips messages correctly", async () => {
        const messages = [
            { id: "1", role: "user" as const, content: "Hello" },
            { id: "2", role: "model" as const, content: "Hi there!" },
        ];
        await saveConversation("octocat", "myrepo", messages);

        const loaded = await loadConversation("octocat", "myrepo");
        expect(loaded).not.toBeNull();
        expect(loaded!.length).toBe(2);
        expect(loaded![0].content).toBe("Hello");
        expect(loaded![1].content).toBe("Hi there!");
    });

    it("returns null for non-existent conversation", async () => {
        const result = await loadConversation("nobody", "norepo");
        expect(result).toBeNull();
    });

    it("loads legacy payloads and preserves extra optional fields", async () => {
        localStorage.setItem("repomind_chat_owner_repo", JSON.stringify({
            owner: "owner",
            repo: "repo",
            timestamp: Date.now(),
            messages: [
                { id: "1", role: "user", content: "hello" },
                { id: "2", role: "model", content: "world", modelUsed: "thinking" },
                { id: "invalid", role: "system", content: "skip" },
            ],
        }));

        const loaded = await loadConversation("owner", "repo");
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
        expect(loaded?.[0]).toMatchObject({ id: "1", role: "user", content: "hello" });

        const second = loaded?.[1] as Record<string, unknown>;
        expect(second.modelUsed).toBe("thinking");
    });

    it("drops stale empty model placeholders while preserving meaningful model payloads", async () => {
        localStorage.setItem("repomind_chat_owner_repo", JSON.stringify({
            owner: "owner",
            repo: "repo",
            timestamp: Date.now(),
            messages: [
                { id: "u1", role: "user", content: "hello" },
                { id: "stale", role: "model", content: "", streamStatus: "Selecting relevant files" },
                { id: "scan", role: "model", content: "", scanStatus: "quick_running" },
                { id: "reasoning", role: "model", content: "", reasoningSteps: ["Thinking"] },
                { id: "answer", role: "model", content: "done" },
            ],
        }));

        const loaded = await loadConversation("owner", "repo");
        expect(loaded).not.toBeNull();
        expect(loaded?.map((message) => message.id)).toEqual(["u1", "scan", "reasoning", "answer"]);
    });

    it("treats successful empty cloud response as authoritative and clears stale local cache", async () => {
        localStorage.setItem("repomind_chat_owner_repo", JSON.stringify({
            owner: "owner",
            repo: "repo",
            timestamp: Date.now(),
            messages: [{ id: "1", role: "user", content: "stale local" }],
        }));

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ messages: [] }),
        });

        const loaded = await loadConversation("owner", "repo", true);
        expect(loaded).toBeNull();
        expect(localStorage.getItem("repomind_chat_owner_repo")).toBeNull();
    });

    it("serializes cloud save and clear mutations so clear runs last", async () => {
        let releasePost: (() => void) | null = null;
        const postGate = new Promise<void>((resolve) => {
            releasePost = resolve;
        });

        fetchMock.mockImplementation((_url: string, init?: { method?: string }) => {
            if (init?.method === "POST") {
                return postGate.then(() => ({
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    json: async () => ({ success: true }),
                }));
            }

            if (init?.method === "DELETE") {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    json: async () => ({ success: true }),
                });
            }

            return Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({ messages: [] }),
            });
        });

        const savePromise = saveConversation("owner", "repo", [{ id: "1", role: "user", content: "A" }], true);
        await Promise.resolve();
        const clearPromise = clearConversation("owner", "repo", true);
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");

        releasePost?.();
        await savePromise;
        await clearPromise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    });
});

describe("loadProfileConversation normalization", () => {
    it("drops stale empty model placeholders in profile chat history", async () => {
        localStorage.setItem("repomind_profile_octocat", JSON.stringify({
            username: "octocat",
            timestamp: Date.now(),
            messages: [
                { id: "u1", role: "user", content: "hello" },
                { id: "stale", role: "model", content: "", streamStatus: "Preparing profile analysis" },
                { id: "reasoning", role: "model", content: "", reasoningSteps: ["Working"] },
                { id: "m1", role: "model", content: "summary" },
            ],
        }));

        const loaded = await loadProfileConversation("octocat");
        expect(loaded).not.toBeNull();
        expect(loaded?.map((message) => message.id)).toEqual(["u1", "reasoning", "m1"]);
    });
});

// ─── clearConversation ────────────────────────────────────────────────────────

describe("clearConversation", () => {
    it("clears a saved conversation", async () => {
        const messages = [{ id: "1", role: "user" as const, content: "to be cleared" }];
        await saveConversation("owner", "repo", messages);
        await clearConversation("owner", "repo");

        const result = await loadConversation("owner", "repo");
        expect(result).toBeNull();
    });
});

// ─── getStorageStats ──────────────────────────────────────────────────────────

describe("getStorageStats", () => {
    it("returns an object with required numeric fields", () => {
        const stats = getStorageStats();
        expect(typeof stats.used).toBe("number");
        expect(typeof stats.available).toBe("number");
        expect(typeof stats.conversations).toBe("number");
        expect(typeof stats.percentage).toBe("number");
    });

    it("percentage is between 0 and 100", () => {
        const stats = getStorageStats();
        expect(stats.percentage).toBeGreaterThanOrEqual(0);
        expect(stats.percentage).toBeLessThanOrEqual(100);
    });

    it("used increases after saving data", async () => {
        const before = getStorageStats().used;
        await saveConversation("u", "r", [
            { id: "x", role: "user", content: "some message for storage" },
        ]);
        const after = getStorageStats().used;
        expect(after).toBeGreaterThan(before);
    });
});
