import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
    authMock,
    getAnonymousActorIdMock,
    getToolBudgetWindowUsageMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    getAnonymousActorIdMock: vi.fn(),
    getToolBudgetWindowUsageMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/actor-id", () => ({
    getAnonymousActorId: getAnonymousActorIdMock,
}));

vi.mock("@/lib/cache", () => ({
    getToolBudgetWindowUsage: getToolBudgetWindowUsageMock,
}));

import { GET } from "@/app/api/chat/quota/route";

describe("GET /api/chat/quota", () => {
    beforeEach(() => {
        authMock.mockReset();
        getAnonymousActorIdMock.mockReset();
        getToolBudgetWindowUsageMock.mockReset();

        getAnonymousActorIdMock.mockReturnValue("anon_actor");
        getToolBudgetWindowUsageMock.mockResolvedValue({
            used: 4,
            limit: 10,
            remaining: 6,
            resetAt: "2026-03-24T00:00:00.000Z",
            windowSecondsRemaining: 3600,
        });
    });

    it("returns anonymous quota when no session exists", async () => {
        authMock.mockResolvedValue(null);

        const request = new NextRequest("http://localhost/api/chat/quota?scope=repo");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(getToolBudgetWindowUsageMock).toHaveBeenCalledWith("repo", "anonymous", "anon_actor");
        expect(body).toMatchObject({
            scope: "repo",
            audience: "anonymous",
            used: 4,
            limit: 10,
            remaining: 6,
            exhausted: false,
        });
    });

    it("returns authenticated quota when session user id is available", async () => {
        authMock.mockResolvedValue({
            user: { id: "user_123", email: "user@example.com" },
        });

        const request = new NextRequest("http://localhost/api/chat/quota?scope=profile");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(getToolBudgetWindowUsageMock).toHaveBeenCalledWith("profile", "authenticated", "user_123");
        expect(body).toMatchObject({
            scope: "profile",
            audience: "authenticated",
        });
    });

    it("returns 400 for invalid scope", async () => {
        authMock.mockResolvedValue(null);

        const request = new NextRequest("http://localhost/api/chat/quota?scope=invalid");
        const response = await GET(request);

        expect(response.status).toBe(400);
    });
});
