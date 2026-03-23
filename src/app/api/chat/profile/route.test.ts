import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
    authMock,
    processProfileQueryStreamMock,
    trackAuthenticatedQueryEventMock,
    trackEventMock,
    getToolBudgetUsageMock,
    consumeToolBudgetUsageMock,
    getAnonymousActorIdMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    processProfileQueryStreamMock: vi.fn(),
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
    processProfileQueryStream: processProfileQueryStreamMock,
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

import { POST } from "@/app/api/chat/profile/route";

describe("POST /api/chat/profile", () => {
    beforeEach(() => {
        authMock.mockReset();
        processProfileQueryStreamMock.mockReset();
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
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "content", text: "hello", append: true };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
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
        expect(processProfileQueryStreamMock).toHaveBeenCalledWith(
            "Summarize profile",
            {},
            "flash",
            expect.objectContaining({
                cacheAudience: "anonymous",
                cacheActorId: "anon_actor",
                crossRepoEnabled: false,
                history: [],
            })
        );
        expect(getToolBudgetUsageMock).toHaveBeenCalledWith("profile", "anonymous", "anon_actor");
        expect(trackAuthenticatedQueryEventMock).not.toHaveBeenCalled();
        // Anonymous visitors should be tracked via trackEvent with the anon actorId
        expect(trackEventMock).toHaveBeenCalledWith("anon_actor", "query", expect.objectContaining({ device: "desktop" }));
    });

    it("tracks anonymous visitors via trackEvent with anon_ actorId", async () => {
        authMock.mockResolvedValue(null);
        getAnonymousActorIdMock.mockReturnValue("anon_xyz789");
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
                "user-agent": "Dalvik/2.1.0 (Linux; Android 14)",
                "x-vercel-ip-country": "DE",
            },
        });

        const response = await POST(request);
        await response.text();

        expect(response.status).toBe(200);
        expect(trackAuthenticatedQueryEventMock).not.toHaveBeenCalled();
        expect(trackEventMock).toHaveBeenCalledWith("anon_xyz789", "query", {
            country: "DE",
            device: "desktop",
            userAgent: "Dalvik/2.1.0 (Linux; Android 14)",
        });
    });

    it("returns INVALID_SESSION when user exists without id", async () => {
        authMock.mockResolvedValue({
            user: { name: "User", email: "user@example.com" },
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
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
        expect(processProfileQueryStreamMock).not.toHaveBeenCalled();
        expect(trackAuthenticatedQueryEventMock).not.toHaveBeenCalled();
        expect(trackEventMock).not.toHaveBeenCalled();
    });

    it("returns login-required code for anonymous thinking mode", async () => {
        authMock.mockResolvedValue(null);

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Deep profile analysis",
                profileContext: {},
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
        expect(processProfileQueryStreamMock).not.toHaveBeenCalled();
    });

    it("continues streaming with tool calls disabled when budget is exhausted", async () => {
        authMock.mockResolvedValue(null);
        getToolBudgetUsageMock.mockResolvedValueOnce({ used: 10, limit: 10, remaining: 0 });
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "status", message: "Tool calls are paused for this window.", progress: 50 };
            yield { type: "content", text: "fallback answer", append: true };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
                modelPreference: "flash",
            }),
            headers: {
                "content-type": "application/json",
            },
        });

        const response = await POST(request);
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(processProfileQueryStreamMock).toHaveBeenCalled();
        expect(processProfileQueryStreamMock.mock.calls[0]?.[3]).toMatchObject({ disableToolCalls: true });
        expect(text).toContain("fallback answer");
        expect(consumeToolBudgetUsageMock).not.toHaveBeenCalled();
    });

    it("tracks analytics for authenticated users via trackAuthenticatedQueryEvent only", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "content", text: "hello" };
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 2 };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
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
        // Auth user tracked via trackAuthenticatedQueryEvent, NOT trackEvent
        expect(trackAuthenticatedQueryEventMock).toHaveBeenCalledWith("user_123", undefined);
        expect(trackEventMock).not.toHaveBeenCalled();
        expect(consumeToolBudgetUsageMock).toHaveBeenCalledWith("profile", "authenticated", "user_123", 2);
    });

    it("does not bill native web-search tool units", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "tool", name: "googleSearch", usageUnits: 4 };
            yield { type: "content", text: "hello" };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
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
        processProfileQueryStreamMock.mockImplementation(async function* () {
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 1, billable: false };
            yield { type: "tool", name: "fetch_recent_commits", usageUnits: 1, billable: true };
            yield { type: "content", text: "hello" };
            yield { type: "complete", relevantFiles: [] };
        });

        const request = new NextRequest("http://localhost/api/chat/profile", {
            method: "POST",
            body: JSON.stringify({
                query: "Summarize profile",
                profileContext: {},
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
        expect(consumeToolBudgetUsageMock).toHaveBeenCalledWith("profile", "authenticated", "user_123", 1);
    });
});
