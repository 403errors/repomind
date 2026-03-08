import { afterEach, describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { isAdminUser } from "@/lib/admin-auth";

const ORIGINAL_ADMIN_USERNAME = process.env.ADMIN_GITHUB_USERNAME;

function withUsername(username?: string): Session {
    return {
        expires: "2099-01-01T00:00:00.000Z",
        user: {
            name: "Test User",
            email: "test@example.com",
            image: null,
            username,
        },
    };
}

afterEach(() => {
    if (ORIGINAL_ADMIN_USERNAME === undefined) {
        delete process.env.ADMIN_GITHUB_USERNAME;
    } else {
        process.env.ADMIN_GITHUB_USERNAME = ORIGINAL_ADMIN_USERNAME;
    }
});

describe("isAdminUser", () => {
    it("returns true for the configured admin username", () => {
        process.env.ADMIN_GITHUB_USERNAME = "403errors";
        expect(isAdminUser(withUsername("403errors"))).toBe(true);
    });

    it("returns false for unauthenticated sessions", () => {
        process.env.ADMIN_GITHUB_USERNAME = "403errors";
        expect(isAdminUser(null)).toBe(false);
    });

    it("returns false for authenticated non-admin users", () => {
        process.env.ADMIN_GITHUB_USERNAME = "403errors";
        expect(isAdminUser(withUsername("someone-else"))).toBe(false);
    });

    it("returns false when ADMIN_GITHUB_USERNAME is missing", () => {
        delete process.env.ADMIN_GITHUB_USERNAME;
        expect(isAdminUser(withUsername("403errors"))).toBe(false);
    });
});
