import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Vercel KV caching utilities for GitHub API responses
 * Gracefully degrades when KV is unavailable
 */

// Cache TTLs (in seconds)
const TTL_FILE = 3600; // 1 hour
const TTL_FILE_ANON = 1800; // 30 minutes
const TTL_REPO = 900; // 15 minutes
const TTL_PROFILE = 1800; // 30 minutes
const TTL_COMMIT_SNAPSHOT = 900; // 15 minutes
const TTL_SCAN = 604800; // 7 days
const TTL_REPO_UNAVAILABLE = 1800; // 30 minutes
const TTL_BUDGET_WINDOW = 86400; // 24 hours
const FILE_CACHE_MAX_ANON_BYTES = 10 * 1024 * 1024; // 10MB/day
const FILE_CACHE_MAX_AUTH_BYTES = 20 * 1024 * 1024; // 20MB/day
const ANON_MAX_CACHEABLE_FILE_BYTES = 128 * 1024; // 128KB
const TOOL_BUDGET_MAX_ANON = 10;
const TOOL_BUDGET_MAX_AUTH = 30;

export type CacheAudience = "anonymous" | "authenticated";
export type RepoVisibility = "public" | "private";
export type ToolBudgetScope = "profile" | "repo";

export interface FileCachePolicy {
    audience: CacheAudience;
    actorId?: string;
    visibility?: RepoVisibility;
    consecutivePaths?: string[];
}

interface RepoFullContextCachePayload {
    metadata: unknown;
    languages: unknown;
    commits: unknown;
    readme: string | null;
}

interface CommitSnapshotCachePayload<T> {
    data: T;
    fetchedAt: number;
}

export interface ToolBudgetUsage {
    used: number;
    limit: number;
    remaining: number;
}

export interface ToolBudgetWindowUsage extends ToolBudgetUsage {
    resetAt: string;
    windowSecondsRemaining: number;
}

// Helper to handle KV errors gracefully
async function safeKvOperation<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
        return await operation();
    } catch (error) {
        console.warn("KV operation failed (gracefully degrading):", error);
        return null;
    }
}

function normalizePolicy(policy?: FileCachePolicy): Required<FileCachePolicy> {
    return {
        audience: policy?.audience ?? "authenticated",
        actorId: policy?.actorId ?? "unknown",
        visibility: policy?.visibility ?? "public",
        consecutivePaths: policy?.consecutivePaths ?? [],
    };
}

function getFileCacheNamespace(owner: string, repo: string, policy?: FileCachePolicy): string {
    const normalized = normalizePolicy(policy);
    if (normalized.visibility === "private") {
        const actor = normalized.actorId || "unknown";
        return `private:${actor}:${owner}/${repo}`;
    }
    return `public:${owner}/${repo}`;
}

function getFileCacheKey(owner: string, repo: string, path: string, sha: string, policy?: FileCachePolicy): string {
    const namespace = getFileCacheNamespace(owner, repo, policy);
    return `file:${namespace}:${path}:${sha}`;
}

function getDailyBudgetKey(policy?: FileCachePolicy): string {
    const normalized = normalizePolicy(policy);
    const day = new Date().toISOString().slice(0, 10);
    const actor = normalized.actorId || "unknown";
    return `cache_budget:file:${normalized.audience}:${actor}:${day}`;
}

function getQueryCacheNamespace(owner: string, repo: string, policy?: FileCachePolicy): string {
    const normalized = normalizePolicy(policy);
    if (normalized.visibility === "private") {
        const actor = normalized.actorId || "unknown";
        return `private:${actor}:${owner}/${repo}`;
    }
    return `public:${owner}/${repo}`;
}

function getAnonConsecutiveNamespace(owner: string, repo: string, policy?: FileCachePolicy): string {
    const normalized = normalizePolicy(policy);
    const actor = normalized.actorId || "unknown";
    if (normalized.visibility === "private") {
        return `private:${actor}:${owner}/${repo}`;
    }
    return `public:${actor}:${owner}/${repo}`;
}

function getToolBudgetKey(scope: ToolBudgetScope, audience: CacheAudience, actorId?: string, day?: string): string {
    const actor = actorId?.trim() || "unknown";
    const budgetDay = day ?? getCurrentBudgetDay();
    return `tool_budget:${scope}:${audience}:${actor}:${budgetDay}`;
}

function getToolBudgetLimit(audience: CacheAudience): number {
    return audience === "anonymous" ? TOOL_BUDGET_MAX_ANON : TOOL_BUDGET_MAX_AUTH;
}

function getCurrentBudgetDay(nowMs: number = Date.now()): string {
    return new Date(nowMs).toISOString().slice(0, 10);
}

function getNextUtcMidnightMs(nowMs: number = Date.now()): number {
    const now = new Date(nowMs);
    return Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0
    );
}

function getBudgetResetInfo(nowMs: number = Date.now()): { resetAt: string; windowSecondsRemaining: number } {
    const nextMidnightMs = getNextUtcMidnightMs(nowMs);
    return {
        resetAt: new Date(nextMidnightMs).toISOString(),
        windowSecondsRemaining: Math.max(1, Math.ceil((nextMidnightMs - nowMs) / 1000)),
    };
}

function getProfileCommitSnapshotKey(username: string, limit: number): string {
    return `commit_snapshot:profile:${username.toLowerCase()}:${limit}`;
}

function getRepoCommitSnapshotKey(owner: string, repo: string, limit: number): string {
    return `commit_snapshot:repo:${owner.toLowerCase()}/${repo.toLowerCase()}:${limit}`;
}

export async function resolveAnonymousConsecutivePaths(
    owner: string,
    repo: string,
    paths: string[],
    policy?: FileCachePolicy
): Promise<string[]> {
    const normalized = normalizePolicy(policy);
    if (normalized.audience !== "anonymous" || paths.length === 0) {
        return [];
    }

    const namespace = getAnonConsecutiveNamespace(owner, repo, normalized);
    const sequenceKey = `anon_query_seq:${namespace}`;
    const currentSeqRaw = await safeKvOperation(() => kv.incrby(sequenceKey, 1));
    const currentSeq = typeof currentSeqRaw === "number" ? currentSeqRaw : 0;
    if (currentSeq === 1) {
        await safeKvOperation(() => kv.expire(sequenceKey, TTL_BUDGET_WINDOW));
    }

    const uniquePaths = Array.from(new Set(paths));
    const lastSeenKeys = uniquePaths.map((path) => `anon_last_seen:${namespace}:${path}`);
    const lastSeenValues = await safeKvOperation(() => kv.mget<number[]>(lastSeenKeys));
    const consecutive: string[] = [];

    if (Array.isArray(lastSeenValues)) {
        lastSeenValues.forEach((seen, index) => {
            if (typeof seen === "number" && seen === currentSeq - 1) {
                consecutive.push(uniquePaths[index]);
            }
        });
    }

    await Promise.all(
        uniquePaths.map(async (path) => {
            const key = `anon_last_seen:${namespace}:${path}`;
            await safeKvOperation(() => kv.setex(key, TTL_BUDGET_WINDOW, currentSeq));
        })
    );

    return consecutive;
}

export async function getToolBudgetUsage(
    scope: ToolBudgetScope,
    audience: CacheAudience,
    actorId?: string
): Promise<ToolBudgetUsage> {
    const key = getToolBudgetKey(scope, audience, actorId);
    const usedRaw = await safeKvOperation(() => kv.get<number>(key));
    const used = typeof usedRaw === "number" ? usedRaw : 0;
    const limit = getToolBudgetLimit(audience);
    const remaining = Math.max(0, limit - used);
    return { used, limit, remaining };
}

export async function getToolBudgetWindowUsage(
    scope: ToolBudgetScope,
    audience: CacheAudience,
    actorId?: string
): Promise<ToolBudgetWindowUsage> {
    const usage = await getToolBudgetUsage(scope, audience, actorId);
    return {
        ...usage,
        ...getBudgetResetInfo(),
    };
}

export async function consumeToolBudgetUsage(
    scope: ToolBudgetScope,
    audience: CacheAudience,
    actorId: string | undefined,
    units: number = 1
): Promise<ToolBudgetWindowUsage> {
    const key = getToolBudgetKey(scope, audience, actorId);
    const normalizedUnits = Math.max(0, Math.floor(units));
    if (normalizedUnits === 0) {
        return getToolBudgetWindowUsage(scope, audience, actorId);
    }

    const { resetAt, windowSecondsRemaining } = getBudgetResetInfo();
    const nextRaw = await safeKvOperation(() => kv.incrby(key, normalizedUnits));
    const next = typeof nextRaw === "number" ? nextRaw : normalizedUnits;
    await safeKvOperation(() => kv.expire(key, Math.max(1, Math.min(TTL_BUDGET_WINDOW, windowSecondsRemaining + 60))));

    const limit = getToolBudgetLimit(audience);
    return {
        used: next,
        limit,
        remaining: Math.max(0, limit - next),
        resetAt,
        windowSecondsRemaining,
    };
}

export async function getCachedProfileCommitSnapshot<T>(
    username: string,
    limit: number
): Promise<CommitSnapshotCachePayload<T> | null> {
    const key = getProfileCommitSnapshotKey(username, limit);
    const cached = await safeKvOperation(() => kv.get<CommitSnapshotCachePayload<T>>(key));
    if (!cached || typeof cached !== "object") {
        return null;
    }
    if (typeof cached.fetchedAt !== "number") {
        return null;
    }
    return cached;
}

export async function cacheProfileCommitSnapshot<T>(
    username: string,
    limit: number,
    data: T
): Promise<void> {
    const key = getProfileCommitSnapshotKey(username, limit);
    const payload: CommitSnapshotCachePayload<T> = {
        data,
        fetchedAt: Date.now(),
    };
    await safeKvOperation(() => kv.setex(key, TTL_COMMIT_SNAPSHOT, payload));
}

export async function getCachedRepoCommitSnapshot<T>(
    owner: string,
    repo: string,
    limit: number
): Promise<CommitSnapshotCachePayload<T> | null> {
    const key = getRepoCommitSnapshotKey(owner, repo, limit);
    const cached = await safeKvOperation(() => kv.get<CommitSnapshotCachePayload<T>>(key));
    if (!cached || typeof cached !== "object") {
        return null;
    }
    if (typeof cached.fetchedAt !== "number") {
        return null;
    }
    return cached;
}

export async function cacheRepoCommitSnapshot<T>(
    owner: string,
    repo: string,
    limit: number,
    data: T
): Promise<void> {
    const key = getRepoCommitSnapshotKey(owner, repo, limit);
    const payload: CommitSnapshotCachePayload<T> = {
        data,
        fetchedAt: Date.now(),
    };
    await safeKvOperation(() => kv.setex(key, TTL_COMMIT_SNAPSHOT, payload));
}

async function isWithinFileCacheBudget(estimatedBytes: number, policy?: FileCachePolicy): Promise<boolean> {
    const normalized = normalizePolicy(policy);
    const limit = normalized.audience === "anonymous" ? FILE_CACHE_MAX_ANON_BYTES : FILE_CACHE_MAX_AUTH_BYTES;
    const key = getDailyBudgetKey(normalized);
    const currentRaw = await safeKvOperation(() => kv.get<number>(key));
    const current = typeof currentRaw === "number" ? currentRaw : 0;
    return current + estimatedBytes <= limit;
}

async function addToFileCacheBudget(estimatedBytes: number, policy?: FileCachePolicy): Promise<void> {
    const key = getDailyBudgetKey(policy);
    await safeKvOperation(async () => {
        const next = await kv.incrby(key, estimatedBytes);
        if (typeof next === "number" && next === estimatedBytes) {
            await kv.expire(key, TTL_BUDGET_WINDOW);
        }
        return next;
    });
}

async function shouldAdmitAnonymousFileCache(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    policy?: FileCachePolicy
): Promise<boolean> {
    const normalized = normalizePolicy(policy);
    if (normalized.audience !== "anonymous") return true;

    const namespace = getFileCacheNamespace(owner, repo, normalized);
    const key = `file_hit:${namespace}:${path}:${sha}`;
    const hitsRaw = await safeKvOperation(() => kv.incrby(key, 1));
    const hits = typeof hitsRaw === "number" ? hitsRaw : 0;
    if (hits === 1) {
        await safeKvOperation(() => kv.expire(key, TTL_BUDGET_WINDOW));
    }
    // Cache-on-second-hit for anonymous traffic to avoid low-value one-offs.
    return hits >= 2;
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
    content: string,
    policy?: FileCachePolicy
): Promise<void> {
    const normalized = normalizePolicy(policy);
    const maxValueBytes = 2 * 1024 * 1024;
    const isConsecutiveAnonPath =
        normalized.audience === "anonymous" &&
        Array.isArray(normalized.consecutivePaths) &&
        normalized.consecutivePaths.includes(path);
    const maxBytes = normalized.audience === "anonymous"
        ? (isConsecutiveAnonPath ? maxValueBytes : ANON_MAX_CACHEABLE_FILE_BYTES)
        : maxValueBytes;

    // Skip caching large files to avoid value limits and low ROI.
    if (content.length > maxBytes) {
        return;
    }

    if (!(await shouldAdmitAnonymousFileCache(owner, repo, path, sha, normalized))) {
        return;
    }

    const key = getFileCacheKey(owner, repo, path, sha, normalized);
    const ttl = normalized.audience === "anonymous" ? TTL_FILE_ANON : TTL_FILE;

    // Compress content
    try {
        const compressed = gzipSync(Buffer.from(content));
        // Store as base64 with prefix to identify compressed content
        const value = `gz:${compressed.toString('base64')}`;
        const estimatedBytes = Buffer.byteLength(value, "utf8");

        if (!(await isWithinFileCacheBudget(estimatedBytes, normalized))) {
            return;
        }

        await safeKvOperation(() => kv.setex(key, ttl, value));
        await addToFileCacheBudget(estimatedBytes, normalized);
    } catch {
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
    sha: string,
    policy?: FileCachePolicy
): Promise<string | null> {
    const key = getFileCacheKey(owner, repo, path, sha, policy);
    const cached = await safeKvOperation(() => kv.get<string>(key));

    if (!cached) return null;

    // Check for compression prefix
    if (cached.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.slice(3), 'base64');
            return gunzipSync(buffer).toString();
        } catch {
            console.error("Failed to decompress cached file:", path);
            return null;
        }
    }

    return cached;
}

/**
 * Get multiple cached files in a single KV round-trip
 */
export async function getCachedFilesBatch(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha: string }>,
    policy?: FileCachePolicy
): Promise<Array<string | null>> {
    if (files.length === 0) return [];

    const keys = files.map(f => getFileCacheKey(owner, repo, f.path, f.sha, policy));
    const results = await safeKvOperation(() => kv.mget<string[]>(keys));

    if (!results) return files.map(() => null);

    return results.map((cached, i) => {
        if (!cached) return null;
        if (typeof cached === 'string' && cached.startsWith('gz:')) {
            try {
                const buffer = Buffer.from(cached.slice(3), 'base64');
                return gunzipSync(buffer).toString();
            } catch {
                console.error("Failed to decompress cached file:", files[i].path);
                return null;
            }
        }
        return typeof cached === 'string' ? cached : JSON.stringify(cached);
    });
}

/**
 * Cache repository metadata
 */
export async function cacheRepoMetadata(
    owner: string,
    repo: string,
    data: unknown,
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
): Promise<unknown | null> {
    const key = `repo:${owner}/${repo}`;
    return await safeKvOperation(() => kv.get<unknown>(key));
}

/**
 * Cache unavailable repository lookups (404/private with token constraints)
 * to avoid repeated API calls for obvious misses.
 */
export async function cacheRepoUnavailable(
    owner: string,
    repo: string,
    ttl: number = TTL_REPO_UNAVAILABLE
): Promise<void> {
    const key = `repo:unavailable:${owner.toLowerCase()}/${repo.toLowerCase()}`;
    await safeKvOperation(() => kv.setex(key, ttl, "1"));
}

export async function getCachedRepoUnavailable(
    owner: string,
    repo: string
): Promise<boolean> {
    const key = `repo:unavailable:${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const cached = await safeKvOperation(() => kv.get<string>(key));
    return cached === "1";
}

/**
 * MEGA-KEY: Cache full repository context (metadata, languages, readme)
 * Utilizes bandwidth to reduce command count
 */
export async function cacheRepoFullContext(
    owner: string,
    repo: string,
    context: RepoFullContextCachePayload
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
): Promise<RepoFullContextCachePayload | null> {
    const key = `repo:full:${owner}/${repo}`;
    const cached = await safeKvOperation(() => kv.get<RepoFullContextCachePayload>(key));

    if (cached && cached.readme && typeof cached.readme === 'string' && cached.readme.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.readme.slice(3), 'base64');
            cached.readme = gunzipSync(buffer).toString();
        } catch {
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
    data: unknown,
    ttl: number = TTL_PROFILE
): Promise<void> {
    const key = `profile:${username}`;
    await safeKvOperation(() => kv.setex(key, ttl, data));
}

/**
 * Get cached profile data
 */
export async function getCachedProfileData(username: string): Promise<unknown | null> {
    const key = `profile:${username}`;
    return await safeKvOperation(() => kv.get<unknown>(key));
}

/**
 * Cache File Tree (Large object, important to cache)
 */
export async function cacheFileTree(
    owner: string,
    repo: string,
    branch: string,
    tree: unknown[]
): Promise<void> {
    const key = `tree:${owner}/${repo}:${branch}`;
    await safeKvOperation(() => kv.setex(key, TTL_REPO, tree));
}

export async function getCachedFileTree(
    owner: string,
    repo: string,
    branch: string
): Promise<unknown[] | null> {
    const key = `tree:${owner}/${repo}:${branch}`;
    return await safeKvOperation(() => kv.get<unknown[]>(key));
}

/**
 * Cache Query Selection (Smart Caching)
 * Maps a query to the files selected by AI
 */
export async function cacheQuerySelection(
    owner: string,
    repo: string,
    query: string,
    files: string[],
    policy?: FileCachePolicy
): Promise<void> {
    // Normalize query to lowercase and trim to increase hit rate
    const normalizedQuery = query.toLowerCase().trim();
    const namespace = getQueryCacheNamespace(owner, repo, policy);
    const key = `query:${namespace}:${normalizedQuery}`;
    // Cache for 24 hours - queries usually yield same files
    await safeKvOperation(() => kv.setex(key, 86400, files));
}

export async function getCachedQuerySelection(
    owner: string,
    repo: string,
    query: string,
    policy?: FileCachePolicy
): Promise<string[] | null> {
    const normalizedQuery = query.toLowerCase().trim();
    const namespace = getQueryCacheNamespace(owner, repo, policy);
    const key = `query:${namespace}:${normalizedQuery}`;
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
    answer: string,
    policy?: FileCachePolicy
): Promise<void> {
    // We hash the file list to ensure if files change, cache invalidates.
    // A simple join is sufficient for our keys since they are relative paths.
    const fileHash = files.sort().join('|').substring(0, 100);
    const normalizedQuery = query.toLowerCase().trim();
    const namespace = getQueryCacheNamespace(owner, repo, policy);
    const key = `answer:${namespace}:${normalizedQuery}:${fileHash}`;

    // Cache for 24 hours
    // We compress the answer if it's large as AI responses can be long
    try {
        const stringified = answer;
        const compressed = gzipSync(Buffer.from(stringified));
        const value = `gz:${compressed.toString('base64')}`;
        // Store both the specific (hashed) and latest answer
        await Promise.all([
            safeKvOperation(() => kv.setex(key, 86400, value)),
            safeKvOperation(() => kv.setex(`latest_answer:${namespace}:${normalizedQuery}`, 86400, value))
        ]);
    } catch {
        console.warn("Failed to compress answer, caching plain text...");
        const stringified = answer;
        await Promise.all([
            safeKvOperation(() => kv.setex(key, 86400, stringified)),
            safeKvOperation(() => kv.setex(`latest_answer:${namespace}:${normalizedQuery}`, 86400, stringified))
        ]);
    }
}

export async function getCachedRepoQueryAnswer(
    owner: string,
    repo: string,
    query: string,
    files: string[],
    policy?: FileCachePolicy
): Promise<string | null> {
    const fileHash = files.sort().join('|').substring(0, 100);
    const normalizedQuery = query.toLowerCase().trim();
    const namespace = getQueryCacheNamespace(owner, repo, policy);
    const key = `answer:${namespace}:${normalizedQuery}:${fileHash}`;

    const cached = await safeKvOperation(() => kv.get<string>(key));
    if (!cached) return null;

    let resultString = cached;
    if (cached.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.slice(3), 'base64');
            resultString = gunzipSync(buffer).toString();
        } catch {
            console.error("Failed to decompress cached answer");
            return null;
        }
    }

    return resultString;
}

/**
 * Short-circuit check for query answer.
 * Checks if there's any answer for this query, ignoring file selection hash.
 * This is faster but potentially slightly less accurate if the codebase changed recently.
 */
export async function getLatestRepoQueryAnswer(
    owner: string,
    repo: string,
    query: string,
    policy?: FileCachePolicy
): Promise<string | null> {
    const normalizedQuery = query.toLowerCase().trim();
    const namespace = getQueryCacheNamespace(owner, repo, policy);
    const key = `latest_answer:${namespace}:${normalizedQuery}`;

    const cached = await safeKvOperation(() => kv.get<string>(key));
    if (!cached) return null;

    let resultString = cached;
    if (cached.startsWith('gz:')) {
        try {
            const buffer = Buffer.from(cached.slice(3), 'base64');
            resultString = gunzipSync(buffer).toString();
        } catch {
            return null;
        }
    }

    return resultString;
}

export interface SecurityScanCacheIdentity {
    scanKey: string;
    files: string[];
    revision: string;
    scanConfig: unknown;
    engineVersion: string;
    cacheKeyVersion: string;
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function buildSecurityScanIdentityHash(identity: SecurityScanCacheIdentity): string {
    const payload = stableStringify({
        scanKey: identity.scanKey.toLowerCase().trim(),
        revision: identity.revision.trim() || "unknown",
        files: [...identity.files].sort(),
        engineVersion: identity.engineVersion,
        cacheKeyVersion: identity.cacheKeyVersion,
        scanConfig: identity.scanConfig,
    });
    return createHash("sha256").update(payload).digest("hex");
}

function buildSecurityScanCacheKey(owner: string, repo: string, identity: SecurityScanCacheIdentity): string {
    const identityHash = buildSecurityScanIdentityHash(identity);
    return `scan_answer:${owner}/${repo}:${identity.cacheKeyVersion}:${identityHash}`;
}

/**
 * Cache security scan result with commit-aware keying.
 * Scan cache TTL is 7 days (commit/config-aware keying handles invalidation).
 */
export async function cacheSecurityScanResult(
    owner: string,
    repo: string,
    identity: SecurityScanCacheIdentity,
    result: unknown
): Promise<void> {
    const key = buildSecurityScanCacheKey(owner, repo, identity);

    try {
        const stringified = typeof result === "string" ? result : JSON.stringify(result);
        const compressed = gzipSync(Buffer.from(stringified));
        const value = `gz:${compressed.toString("base64")}`;
        await safeKvOperation(() => kv.setex(key, TTL_SCAN, value));
    } catch {
        console.warn("Failed to compress security scan result, caching plain text...");
        const stringified = typeof result === "string" ? result : JSON.stringify(result);
        await safeKvOperation(() => kv.setex(key, TTL_SCAN, stringified));
    }
}

/**
 * Get security scan result from commit-aware cache.
 */
export async function getCachedSecurityScanResult(
    owner: string,
    repo: string,
    identity: SecurityScanCacheIdentity
): Promise<unknown | null> {
    const key = buildSecurityScanCacheKey(owner, repo, identity);
    const cached = await safeKvOperation(() => kv.get<string>(key));
    if (!cached) return null;

    let resultString = cached;
    if (cached.startsWith("gz:")) {
        try {
            const buffer = Buffer.from(cached.slice(3), "base64");
            resultString = gunzipSync(buffer).toString();
        } catch {
            console.error("Failed to decompress cached security scan result");
            return null;
        }
    }

    try {
        return JSON.parse(resultString);
    } catch {
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
    } catch {
        return { available: false };
    }
}
