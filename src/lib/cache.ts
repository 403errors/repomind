import { kv } from "@vercel/kv";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Vercel KV caching utilities for GitHub API responses
 * Gracefully degrades when KV is unavailable
 */

// Cache TTLs (in seconds)
const TTL_FILE = 3600; // 1 hour
const TTL_REPO = 900; // 15 minutes
const TTL_PROFILE = 1800; // 30 minutes

// Helper to handle KV errors gracefully
async function safeKvOperation<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
        return await operation();
    } catch (error) {
        console.warn("KV operation failed (gracefully degrading):", error);
        return null;
    }
}

/**
 * Cache file content with SHA-based key for auto-invalidation
 * Compresses content and skips files > 2MB
 */
export async function cacheFile(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    content: string
): Promise<void> {
    // Skip caching if content is too large (> 2MB)
    // to avoid hitting Vercel KV request/value size limits
    if (content.length > 2 * 1024 * 1024) {
        return;
    }

    const key = `file:${owner}/${repo}:${path}:${sha}`;

    // Compress content
    try {
        const compressed = gzipSync(Buffer.from(content));
        // Store as base64 with prefix to identify compressed content
        const value = `gz:${compressed.toString('base64')}`;
        await safeKvOperation(() => kv.setex(key, TTL_FILE, value));
    } catch (e) {
        console.warn("Failed to compress/cache file:", path);
        // Fallback: don't cache or cache uncompressed if small enough?
        // Let's just skip caching on error to be safe
    }
}

/**
 * Get cached file content by SHA
 * Returns null if not found or KV unavailable
 * Handles decompression automatically
 */
export async function getCachedFile(
    owner: string,
    repo: string,
    path: string,
    sha: string
): Promise<string | null> {
    const key = `file:${owner}/${repo}:${path}:${sha}`;
    const cached = await safeKvOperation(() => kv.get<string>(key));

    if (!cached) return null;

    // Check for compression prefix
    if (cached.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.slice(3), 'base64');
            return gunzipSync(buffer).toString();
        } catch (e) {
            console.error("Failed to decompress cached file:", path);
            return null;
        }
    }

    return cached;
}

/**
 * Cache repository metadata
 */
export async function cacheRepoMetadata(
    owner: string,
    repo: string,
    data: any,
    ttl: number = TTL_REPO
): Promise<void> {
    const key = `repo:${owner}/${repo}`;
    await safeKvOperation(() => kv.setex(key, ttl, data));
}

/**
 * Get cached repository metadata
 */
export async function getCachedRepoMetadata(
    owner: string,
    repo: string
): Promise<any | null> {
    const key = `repo:${owner}/${repo}`;
    return await safeKvOperation(() => kv.get<any>(key));
}

/**
 * Cache profile data
 */
export async function cacheProfileData(
    username: string,
    data: any,
    ttl: number = TTL_PROFILE
): Promise<void> {
    const key = `profile:${username}`;
    await safeKvOperation(() => kv.setex(key, ttl, data));
}

/**
 * Get cached profile data
 */
export async function getCachedProfileData(username: string): Promise<any | null> {
    const key = `profile:${username}`;
    return await safeKvOperation(() => kv.get<any>(key));
}

/**
 * Cache File Tree (Large object, important to cache)
 */
export async function cacheFileTree(
    owner: string,
    repo: string,
    branch: string,
    tree: any[]
): Promise<void> {
    const key = `tree:${owner}/${repo}:${branch}`;
    await safeKvOperation(() => kv.setex(key, TTL_REPO, tree));
}

export async function getCachedFileTree(
    owner: string,
    repo: string,
    branch: string
): Promise<any[] | null> {
    const key = `tree:${owner}/${repo}:${branch}`;
    return await safeKvOperation(() => kv.get<any[]>(key));
}

/**
 * Cache Query Selection (Smart Caching)
 * Maps a query to the files selected by AI
 */
export async function cacheQuerySelection(
    owner: string,
    repo: string,
    query: string,
    files: string[]
): Promise<void> {
    // Normalize query to lowercase and trim to increase hit rate
    const normalizedQuery = query.toLowerCase().trim();
    const key = `query:${owner}/${repo}:${normalizedQuery}`;
    // Cache for 24 hours - queries usually yield same files
    await safeKvOperation(() => kv.setex(key, 86400, files));
}

export async function getCachedQuerySelection(
    owner: string,
    repo: string,
    query: string
): Promise<string[] | null> {
    const normalizedQuery = query.toLowerCase().trim();
    const key = `query:${owner}/${repo}:${normalizedQuery}`;
    return await safeKvOperation(() => kv.get<string[]>(key));
}

/**
 * Clear all cache for a repository (useful for manual invalidation)
 * TODO: Full implementation requires Redis SCAN support from the KV provider.
 * Currently not implemented — do not call this expecting real cache eviction.
 */
export async function clearRepoCache(owner: string, repo: string): Promise<void> {
    // This is intentionally unimplemented.
    // Pattern-based deletion (SCAN `*:owner/repo:*`) requires a Redis connection
    // that supports SCAN, which @vercel/kv does not expose directly.
    throw new Error(
        `clearRepoCache is not implemented. Cache for ${owner}/${repo} was NOT cleared. ` +
        "Use the Vercel KV dashboard or implement a key-tracking strategy."
    );
}

/**
 * Get cache statistics (for DevTools)
 */
export async function getCacheStats(): Promise<{
    available: boolean;
    keys?: number;
}> {
    try {
        // Simple health check
        await kv.ping();
        return { available: true };
    } catch (error) {
        return { available: false };
    }
}
