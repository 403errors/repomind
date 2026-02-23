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
 * MEGA-KEY: Cache full repository context (metadata, languages, readme)
 * Utilizes bandwidth to reduce command count
 */
export async function cacheRepoFullContext(
    owner: string,
    repo: string,
    context: {
        metadata: any;
        languages: any;
        readme: string | null;
    }
): Promise<void> {
    const key = `repo:full:${owner}/${repo}`;
    // Compress readme if it exists to keep payload reasonable
    let readmeValue = context.readme;
    if (context.readme && context.readme.length > 5000) {
        const compressed = gzipSync(Buffer.from(context.readme));
        readmeValue = `gz:${compressed.toString('base64')}`;
    }

    await safeKvOperation(() => kv.setex(key, TTL_REPO, {
        ...context,
        readme: readmeValue
    }));
}

export async function getCachedRepoFullContext(
    owner: string,
    repo: string
): Promise<any | null> {
    const key = `repo:full:${owner}/${repo}`;
    const cached = await safeKvOperation(() => kv.get<any>(key));

    if (cached && cached.readme && typeof cached.readme === 'string' && cached.readme.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.readme.slice(3), 'base64');
            cached.readme = gunzipSync(buffer).toString();
        } catch (e) {
            console.error("Failed to decompress Mega-Key readme for", repo);
            cached.readme = null;
        }
    }

    return cached;
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
 * Cache Full AI Query Answer
 * Maps a query (plus the files used) to the final generated Markdown answer
 */
export async function cacheRepoQueryAnswer(
    owner: string,
    repo: string,
    query: string,
    files: string[],
    answer: any
): Promise<void> {
    // We hash the file list to ensure if files change, cache invalidates.
    // A simple join is sufficient for our keys since they are relative paths.
    const fileHash = files.sort().join('|').substring(0, 100);
    const normalizedQuery = query.toLowerCase().trim();
    const key = `answer:${owner}/${repo}:${normalizedQuery}:${fileHash}`;

    // Cache for 24 hours
    // We compress the answer if it's large as AI responses can be long
    try {
        const stringified = typeof answer === 'string' ? answer : JSON.stringify(answer);
        const compressed = gzipSync(Buffer.from(stringified));
        const value = `gz:${compressed.toString('base64')}`;
        await safeKvOperation(() => kv.setex(key, 86400, value));
    } catch (e) {
        console.warn("Failed to compress answer, caching plain text...");
        const stringified = typeof answer === 'string' ? answer : JSON.stringify(answer);
        await safeKvOperation(() => kv.setex(key, 86400, stringified));
    }
}

export async function getCachedRepoQueryAnswer(
    owner: string,
    repo: string,
    query: string,
    files: string[]
): Promise<any | null> {
    const fileHash = files.sort().join('|').substring(0, 100);
    const normalizedQuery = query.toLowerCase().trim();
    const key = `answer:${owner}/${repo}:${normalizedQuery}:${fileHash}`;

    const cached = await safeKvOperation(() => kv.get<string>(key));
    if (!cached) return null;

    let resultString = cached;
    if (cached.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.slice(3), 'base64');
            resultString = gunzipSync(buffer).toString();
        } catch (e) {
            console.error("Failed to decompress cached answer");
            return null;
        }
    }

    try {
        return JSON.parse(resultString);
    } catch (e) {
        return resultString;
    }
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
