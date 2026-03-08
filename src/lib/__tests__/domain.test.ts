import { describe, it, expect } from "vitest";
import {
    toProfileContext,
    buildProfileContextString,
    buildRepoReadmeEntry,
    type ProfileContext,
} from "@/lib/domain";
import type { GitHubProfile } from "@/lib/github";

const mockProfile: GitHubProfile = {
    login: "octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/1",
    html_url: "https://github.com/octocat",
    name: "The Octocat",
    bio: "A cool developer",
    location: "San Francisco, CA",
    blog: "https://octocat.io",
    public_repos: 42,
    followers: 1000,
    following: 50,
    created_at: "2011-01-25T18:44:36Z",
};

describe("toProfileContext", () => {
    it("maps all fields correctly", () => {
        const ctx = toProfileContext(mockProfile);
        expect(ctx.username).toBe("octocat");
        expect(ctx.displayName).toBe("The Octocat");
        expect(ctx.bio).toBe("A cool developer");
        expect(ctx.location).toBe("San Francisco, CA");
        expect(ctx.website).toBe("https://octocat.io");
        expect(ctx.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1");
        expect(ctx.publicRepos).toBe(42);
        expect(ctx.followers).toBe(1000);
        expect(ctx.following).toBe(50);
    });

    it("converts null name to null (not undefined)", () => {
        const ctx = toProfileContext({ ...mockProfile, name: null });
        expect(ctx.displayName).toBeNull();
    });

    it("converts undefined bio to null", () => {
        const ctx = toProfileContext({ ...mockProfile, bio: undefined as unknown as string | null });
        expect(ctx.bio).toBeNull();
    });

    it("converts undefined blog to null", () => {
        const ctx = toProfileContext({ ...mockProfile, blog: undefined as unknown as string | null });
        expect(ctx.website).toBeNull();
    });
});

describe("buildProfileContextString", () => {
    const ctx: ProfileContext = {
        username: "octocat",
        displayName: "The Octocat",
        bio: "A cool developer",
        location: "San Francisco, CA",
        website: "https://octocat.io",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
        publicRepos: 42,
        followers: 1000,
        following: 50,
    };

    it("includes username and display name", () => {
        const str = buildProfileContextString(ctx, null);
        expect(str).toContain("octocat");
        expect(str).toContain("The Octocat");
    });

    it("includes bio, location, and website", () => {
        const str = buildProfileContextString(ctx, null);
        expect(str).toContain("A cool developer");
        expect(str).toContain("San Francisco, CA");
        expect(str).toContain("https://octocat.io");
    });

    it("shows N/A for null fields", () => {
        const nullCtx: ProfileContext = {
            ...ctx,
            displayName: null,
            bio: null,
            location: null,
            website: null,
        };
        const str = buildProfileContextString(nullCtx, null);
        expect(str).toContain("N/A");
    });

    it("includes profile README when provided", () => {
        const str = buildProfileContextString(ctx, "# My README\nHello world");
        expect(str).toContain("# My README");
        expect(str).toContain("Hello world");
    });

    it("does not include README section when null", () => {
        const str = buildProfileContextString(ctx, null);
        expect(str).not.toContain("PROFILE README");
    });
});

describe("buildRepoReadmeEntry", () => {
    it("includes core repo info", () => {
        const entry = buildRepoReadmeEntry({
            repo: "my-project",
            content: "# My Project\nA sample repo.",
            updated_at: "2024-01-01",
            description: "A sample project",
            stars: 100,
            forks: 10,
            language: "TypeScript",
        });
        expect(entry).toContain("my-project");
        expect(entry).toContain("TypeScript");
        expect(entry).toContain("100");
        expect(entry).toContain("10");
        expect(entry).toContain("A sample project");
    });

    it("includes README content when provided", () => {
        const entry = buildRepoReadmeEntry({
            repo: "repo",
            content: "# Hello from README",
            updated_at: "2024-01-01",
            description: null,
            stars: 0,
            forks: 0,
            language: null,
        });
        expect(entry).toContain("# Hello from README");
    });

    it("shows placeholder when no content", () => {
        const entry = buildRepoReadmeEntry({
            repo: "repo",
            content: "",
            updated_at: "2024-01-01",
            description: null,
            stars: 0,
            forks: 0,
            language: null,
        });
        expect(entry).toContain("not loaded");
    });

    it("shows Unknown for null language", () => {
        const entry = buildRepoReadmeEntry({
            repo: "repo",
            content: "Content",
            updated_at: "2024-01-01",
            description: null,
            stars: 0,
            forks: 0,
            language: null,
        });
        expect(entry).toContain("Unknown");
    });
});
