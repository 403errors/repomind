/**
 * Domain model layer — A2
 *
 * Transforms raw GitHub API shapes into clean domain types before they
 * flow into AI prompts or business logic. This prevents GitHub API
 * implementation details from leaking into the rest of the system.
 */
import type { GitHubProfile } from "@/lib/github";

// ─── Domain Types ──────────────────────────────────────────────────────────────

/**
 * Clean domain representation of a GitHub user profile.
 * Decoupled from Octokit response shape — fields use camelCase domain names,
 * null values are preserved (not coerced to empty strings at the boundary).
 */
export interface ProfileContext {
    username: string;
    displayName: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
    avatarUrl: string;
    publicRepos: number;
    followers: number;
    following: number;
}

/**
 * Repo README metadata used when building profile context strings.
 * Field names mirror the GitHub API / component prop shape (snake_case)
 * to avoid forcing a rename across every component that provides this data.
 */
export interface RepoReadmeSummary {
    repo: string;
    content: string;
    updated_at: string;
    description: string | null;
    stars: number;
    forks: number;
    language: string | null;
}

// ─── Transformers ──────────────────────────────────────────────────────────────

/**
 * Maps a raw GitHubProfile (Octokit shape) to the domain ProfileContext.
 * Pure function — no IO. Fully testable.
 *
 * This is the single transformation boundary: callers work with ProfileContext,
 * and only this function knows about the shape of GitHubProfile.
 */
export function toProfileContext(profile: GitHubProfile): ProfileContext {
    return {
        username: profile.login,
        displayName: profile.name ?? null,
        bio: profile.bio ?? null,
        location: profile.location ?? null,
        website: profile.blog ?? null,
        avatarUrl: profile.avatar_url,
        publicRepos: profile.public_repos,
        followers: profile.followers,
        following: profile.following,
    };
}

/**
 * Build a formatted markdown-style context string from a ProfileContext.
 * Pure function — no IO. Separated from the transformer so each concern
 * (mapping vs. formatting) can be tested independently.
 */
export function buildProfileContextString(
    ctx: ProfileContext,
    profileReadme: string | null
): string {
    let context = "--- GITHUB PROFILE METADATA ---\n";
    context += `Username: ${ctx.username}\n`;
    context += `Name: ${ctx.displayName ?? "N/A"}\n`;
    context += `Bio: ${ctx.bio ?? "N/A"}\n`;
    context += `Location: ${ctx.location ?? "N/A"}\n`;
    context += `Blog/Website: ${ctx.website ?? "N/A"}\n`;
    context += `Avatar URL: ${ctx.avatarUrl}\n`;
    context += `Public Repos: ${ctx.publicRepos}\n`;
    context += `Followers: ${ctx.followers}\n`;
    context += `Following: ${ctx.following}\n`;

    if (profileReadme) {
        context += `\n--- ${ctx.username.toUpperCase()}'S PROFILE README ---\n${profileReadme}\n`;
    }

    return context;
}

/**
 * Format a single repo README entry for inclusion in a profile context string.
 * Pure function — no IO.
 */
export function buildRepoReadmeEntry(readme: RepoReadmeSummary): string {
    const header =
        `\n--- REPO: ${readme.repo} ---\n` +
        `Language: ${readme.language ?? "Unknown"}\n` +
        `Last Updated: ${readme.updated_at}\n` +
        `Description: ${readme.description ?? "N/A"}\n` +
        `Stars: ${readme.stars}\n` +
        `Forks: ${readme.forks}\n`;

    return readme.content
        ? `${header}\nREADME Content:\n${readme.content}\n`
        : `${header}(README not loaded — ask about this repo for more details)\n`;
}
