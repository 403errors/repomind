import { describe, expect, it } from "vitest";
import {
    getErrorStatus,
    isErrorWithMessage,
    isGitHubProfile,
    isGitHubRepo,
} from "@/lib/github";

describe("getErrorStatus", () => {
    it("returns numeric status codes from error-like objects", () => {
        expect(getErrorStatus({ status: 404 })).toBe(404);
        expect(getErrorStatus({ status: 500, message: "boom" })).toBe(500);
    });

    it("returns undefined for unsupported shapes", () => {
        expect(getErrorStatus({ status: "404" })).toBeUndefined();
        expect(getErrorStatus(new Error("x"))).toBeUndefined();
        expect(getErrorStatus(null)).toBeUndefined();
    });
});

describe("isErrorWithMessage", () => {
    it("detects objects with string message", () => {
        expect(isErrorWithMessage({ message: "failure" })).toBe(true);
        expect(isErrorWithMessage(new Error("failure"))).toBe(true);
    });

    it("rejects missing or non-string messages", () => {
        expect(isErrorWithMessage({})).toBe(false);
        expect(isErrorWithMessage({ message: 42 })).toBe(false);
        expect(isErrorWithMessage(undefined)).toBe(false);
    });
});

describe("GitHub payload guards", () => {
    it("validates GitHub profile shape", () => {
        expect(
            isGitHubProfile({
                login: "octocat",
                avatar_url: "https://example.com/avatar.png",
                html_url: "https://github.com/octocat",
            })
        ).toBe(true);

        expect(isGitHubProfile({ login: "octocat" })).toBe(false);
    });

    it("validates GitHub repo shape", () => {
        expect(
            isGitHubRepo({
                name: "repo",
                full_name: "owner/repo",
                default_branch: "main",
            })
        ).toBe(true);

        expect(isGitHubRepo({ full_name: "owner/repo" })).toBe(false);
    });
});
