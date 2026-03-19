import { getCatalogData, type CatalogRepoEntry } from "@/lib/repo-catalog";
import { getUserRepos, type GitHubRepo } from "@/lib/github";
import { octokit } from "@/lib/github"; // I need to make sure octokit is exported or use a wrapper
import { kv } from "@vercel/kv";

export interface RepoSuggestion {
    owner: string;
    repo: string;
    stars: number;
    description: string | null;
    source: 'local' | 'user' | 'github';
}

const SEARCH_CACHE_TTL = 3600; // 1 hour

/**
 * Get repository suggestions based on a query string.
 * Logic:
 * 1. If query is "username/", fetch all repos for that user.
 * 2. If query is general, search local catalog.
 * 3. If no local results, fallback to GitHub Search API.
 */
export async function getRepoSuggestions(query: string): Promise<RepoSuggestion[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // 1. Check for "username/" or "username/partial" pattern
    if (trimmed.includes('/')) {
        const parts = trimmed.split('/');
        if (parts.length === 2) {
            const [username, repoPartial] = parts;
            try {
                // Fetch all repos for this user (cached)
                const userRepos = await getUserRepos(username);
                
                // Filter by partial repo name if provided
                const filtered = repoPartial 
                    ? userRepos.filter(r => r.name.toLowerCase().includes(repoPartial.toLowerCase()))
                    : userRepos;

                if (filtered.length > 0) {
                    return filtered
                        .sort((a, b) => b.stargazers_count - a.stargazers_count)
                        .slice(0, 10)
                        .map(repo => ({
                            owner: repo.owner.login,
                            repo: repo.name,
                            stars: repo.stargazers_count,
                            description: repo.description,
                            source: 'user' as const
                        }));
                }
            } catch (error) {
                console.error(`Failed to fetch suggested repos for user ${username}:`, error);
            }
        }
    }

    // 2. Search local catalog
    const catalog = await getCatalogData();
    const localMatches = catalog.curatedRepos
        .filter(repo => {
            const fullPath = `${repo.owner}/${repo.repo}`.toLowerCase();
            const q = trimmed.toLowerCase();
            return fullPath.includes(q) || repo.repo.toLowerCase().includes(q);
        })
        .sort((a, b) => b.stars - a.stars)
        .slice(0, 10)
        .map(repo => ({
            owner: repo.owner,
            repo: repo.repo,
            stars: repo.stars,
            description: repo.description,
            source: 'local' as const
        }));

    if (localMatches.length >= 5) {
        return localMatches;
    }

    // 3. Fallback to GitHub Search API (debounced/cached)
    // We only reach here if local matches are few or query is specific
    try {
        const cacheKey = `suggestions:github:${trimmed.toLowerCase()}`;
        const cached = await kv.get<RepoSuggestion[]>(cacheKey);
        if (cached) return [...localMatches, ...cached].slice(0, 10);

        // Actual GitHub Search
        const { data } = await (octokit as any).rest.search.repos({
            q: trimmed,
            sort: 'stars',
            order: 'desc',
            per_page: 10
        });

        const githubMatches = data.items.map((repo: any) => ({
            owner: repo.owner.login,
            repo: repo.name,
            stars: repo.stargazers_count,
            description: repo.description,
            source: 'github' as const
        }));

        await kv.set(cacheKey, githubMatches, { ex: SEARCH_CACHE_TTL });
        return [...localMatches, ...githubMatches].slice(0, 10);
    } catch (error) {
        console.error("GitHub search fallback failed:", error);
    }

    return localMatches;
}
