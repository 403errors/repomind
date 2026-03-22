import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
    authMock,
    generateAnswerStreamMock,
    trackAuthenticatedQueryEventMock,
    trackEventMock,
    getToolBudgetUsageMock,
    consumeToolBudgetUsageMock,
    getAnonymousActorIdMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    generateAnswerStreamMock: vi.fn(),
    trackAuthenticatedQueryEventMock: vi.fn(),
    trackEventMock: vi.fn(),
    getToolBudgetUsageMock: vi.fn(),
    consumeToolBudgetUsageMock: vi.fn(),
    getAnonymousActorIdMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
    auth: authMock,
}));

vi.mock("@/app/actions", () => ({
    generateAnswerStream: generateAnswerStreamMock,
}));

vi.mock("@/lib/analytics", () => ({
    trackAuthenticatedQueryEvent: trackAuthenticatedQueryEventMock,
    trackEvent: trackEventMock,
}));

vi.mock("@/lib/cache", () => ({
    getToolBudgetUsage: getToolBudgetUsageMock,
    consumeToolBudgetUsage: consumeToolBudgetUsageMock,
}));

vi.mock("@/lib/actor-id", () => ({
    getAnonymousActorId: getAnonymousActorIdMock,
}));

import { POST } from "@/app/api/chat/repo/route";

describe("POST /api/chat/repo", () => {
    beforeEach(() => {
        authMock.mockReset();
        generateAnswerStreamMock.mockReset();
        trackAuthenticatedQueryEventMock.mockReset();
        trackEventMock.mockReset();
        getToolBudgetUsageMock.mockReset();
        consumeToolBudgetUsageMock.mockReset();
        getAnonymousActorIdMock.mockReset();

        getToolBudgetUsageMock.mockResolvedValue({ used: 0, limit: 10, remaining: 10 });
        consumeToolBudgetUsageMock.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });
        getAnonymousActorIdMock.mockReturnValue("anon_actor");
    });

    it("allows unauthenticated users in flash mode", async () => {
        authMock.mockResolvedValue(null);
        generateAnswerStreamMock.mockImplementation(async function* () {
            yield { type: "content", text: "hello", append: true };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0",
            },
        });

        const response = await POST(request);
        await response.text();

        expect(response.status).toBe(200);
        expect(generateAnswerStreamMock).toHaveBeenCalledWith(
            "What does this repo do?",
            { owner: "owner", repo: "repo" },
            [],
            undefined,
            "anonymous",
            "anon_actor",
            [],
            undefined,
            "flash",
            false
        );
        expect(getToolBudgetUsageMock).toHaveBeenCalledWith("repo", "anonymous", "anon_actor");
        expect(trackAuthenticatedQueryEventMock).not.toHaveBeenCalled();
        expect(trackEventMock).not.toHaveBeenCalled();
    });

    it("returns INVALID_SESSION when user exists without id", async () => {
        authMock.mockResolvedValue({
            user: { name: "User", email: "user@example.com" },
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
            },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({
            error: "Unauthorized",
            code: "INVALID_SESSION",
        });
        expect(generateAnswerStreamMock).not.toHaveBeenCalled();
        expect(trackAuthenticatedQueryEventMock).not.toHaveBeenCalled();
        expect(trackEventMock).not.toHaveBeenCalled();
    });

    it("returns login-required code for anonymous thinking mode", async () => {
        authMock.mockResolvedValue(null);

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "Deep reasoning",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "thinking",
            }),
            headers: {
                "content-type": "application/json",
            },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({
            error: "Login required for Thinking mode.",
            code: "LOGIN_REQUIRED_THINKING_MODE",
        });
        expect(generateAnswerStreamMock).not.toHaveBeenCalled();
    });

    it("continues streaming with tool calls disabled when budget is exhausted", async () => {
        authMock.mockResolvedValue(null);
        getToolBudgetUsageMock.mockResolvedValueOnce({ used: 10, limit: 10, remaining: 0 });
        generateAnswerStreamMock.mockImplementation(async function* () {
            yield { type: "status", message: "Tool calls are paused for this window.", progress: 50 };
            yield { type: "content", text: "fallback answer", append: true };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
            },
        });

        const response = await POST(request);
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(generateAnswerStreamMock).toHaveBeenCalled();
        expect(generateAnswerStreamMock.mock.calls[0]?.[9]).toBe(true);
        expect(text).toContain("fallback answer");
        expect(consumeToolBudgetUsageMock).not.toHaveBeenCalled();
    });

    it("tracks analytics for authenticated users", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });
        generateAnswerStreamMock.mockImplementation(async function* () {
            yield { type: "content", text: "hello" };
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 3 };
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0 (iPhone; Mobile)",
                "x-vercel-ip-country": "IN",
            },
        });

        const response = await POST(request);
        await response.text();

        expect(response.status).toBe(200);
        expect(trackAuthenticatedQueryEventMock).toHaveBeenCalledWith("user_123");
        expect(trackEventMock).toHaveBeenCalledWith("user_123", "query", {
            country: "IN",
            device: "mobile",
            userAgent: "Mozilla/5.0 (iPhone; Mobile)",
        });
        expect(consumeToolBudgetUsageMock).toHaveBeenCalledWith("repo", "authenticated", "user_123", 3);
    });

    it("does not bill native web-search tool units", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });
        generateAnswerStreamMock.mockImplementation(async function* () {
            yield { type: "tool", name: "googleSearch", usageUnits: 2 };
            yield { type: "content", text: "hello" };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0",
            },
        });

        const response = await POST(request);
        await response.text();

        expect(response.status).toBe(200);
        expect(consumeToolBudgetUsageMock).not.toHaveBeenCalled();
    });

    it("bills only one unit when a non-billable tool-intent event is followed by a billable completion event", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });
        generateAnswerStreamMock.mockImplementation(async function* () {
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 1, billable: false };
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 1, billable: true };
            yield { type: "content", text: "hello" };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/repo", {
            method: "POST",
            body: JSON.stringify({
                query: "What does this repo do?",
                repoDetails: { owner: "owner", repo: "repo" },
                filePaths: [],
                history: [],
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0",
            },
        });

        const response = await POST(request);
        await response.text();

        expect(response.status).toBe(200);
        expect(consumeToolBudgetUsageMock).toHaveBeenCalledWith("repo", "authenticated", "user_123", 1);
    });
});
