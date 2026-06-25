import { kv } from "@vercel/kv";
import { gzipSync, gunzipSync } from "node:zlib";

export type RepoIndexEntry = {
    path: string;
    tokens: string[];
    filenameTokens: string[];
    coreBoost: number;
    semanticGroup?: string;  // "api" | "ui" | "ml" | "config" | "test" | "util" | "other"
    contextHint?: string;     // e.g., "gemini", "llm", "database", "api-integration"
};

export type RepoIndex = {
    version: number;
    createdAt: number;
    entries: RepoIndexEntry[];
};

export type RepoIndexSearchResult = {
    files: string[];
    bestScore: number;
    scoreThreshold: number;
};

const INDEX_VERSION = 1;
const INDEX_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const INDEX_ACCESS_TTL_SECONDS = 60 * 60 * 24; // 24h window
const INDEX_MIN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const INDEX_EVICT_ACCESS_THRESHOLD = 3;
const INDEX_ACCESS_THROTTLE_MS = 15 * 60 * 1000;

const CORE_FILE_PATTERNS: Array<{ pattern: RegExp; boost: number }> = [
    { pattern: /(^|\/)package\.json$/i, boost: 3 },
    { pattern: /(^|\/)tsconfig\.json$/i, boost: 2 },
    { pattern: /(^|\/)next\.config\.(js|mjs|ts)$/i, boost: 2 },
    { pattern: /(^|\/)vite\.config\.(js|ts|mjs)$/i, boost: 2 },
    { pattern: /(^|\/)app\.(ts|tsx|js|jsx)$/i, boost: 2 },
    { pattern: /(^|\/)index\.(ts|tsx|js|jsx|py|go|rs)$/i, boost: 2 },
    { pattern: /(^|\/)main\.(ts|tsx|js|jsx|py|go|rs)$/i, boost: 2 },
    { pattern: /(^|\/)server\.(ts|js|py|go|rs)$/i, boost: 1 },
    { pattern: /(^|\/)router\.(ts|tsx|js|jsx)$/i, boost: 1 },
    { pattern: /(^|\/)routes\.(ts|tsx|js|jsx)$/i, boost: 1 },
    { pattern: /(^|\/)src\/index\.(ts|tsx|js|jsx)$/i, boost: 2 },
    { pattern: /(^|\/)src\/app\.(ts|tsx|js|jsx)$/i, boost: 2 },
];

// ─── Semantic Grouping ────────────────────────────────────────────────────────

/**
 * Classifies file paths by semantic domain for better ranking.
 * Used to boost files when queries are domain-specific.
 */
function getSemanticGroup(path: string): string {
    const patterns = {
        api: /\/(api|routes|endpoints|server|handler|middleware)\//i,
        ui: /\/(components|pages|ui|views|layout|screen)\//i,
        ml: /\/(gemini|ai|model|ml|inference|llm|ai-client)\//i,
        config: /\.(config|env|settings|constants|setup)\./i,
        test: /\.(test|spec)\.tsx?$/i,
        util: /\/(utils|helpers|lib|services)\//i,
    };

    for (const [group, pattern] of Object.entries(patterns)) {
        if (pattern.test(path)) {
            return group;
        }
    }
    return "other";
}

/**
 * Extracts context hints from file content (first few lines).
 * Helps identify AI/ML files, database files, etc. at a glance.
 */
function extractContextHint(content: string): string | undefined {
    if (!content || content.length === 0) return undefined;
    
    const firstLines = content.split('\n').slice(0, 3).join(' ').toLowerCase();
    const keywords = ["gemini", "openai", "llm", "database", "cache", "api", "webhook", "ai-"];
    
    for (const keyword of keywords) {
        if (firstLines.includes(keyword)) {
            return keyword;
        }
    }
    return undefined;
}

// ─── Tokenization ─────────────────────────────────────────────────────────────

export function tokenizeText(input: string): string[] {
    const normalized = input
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .toLowerCase();

    const tokens = normalized
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => token.length >= 2);

    return Array.from(new Set(tokens));
}

function getCoreBoost(path: string): number {
    for (const entry of CORE_FILE_PATTERNS) {
        if (entry.pattern.test(path)) {
            return entry.boost;
        }
    }
    return 0;
}

function getIndexKey(owner: string, repo: string, treeSha: string): string {
    return `repo_index:${owner}/${repo}:${treeSha}:v${INDEX_VERSION}`;
}

function getIndexRegistryKey(owner: string, repo: string): string {
    return `index_keys:${owner}/${repo}`;
}

function getIndexHeadKey(owner: string, repo: string): string {
    return `index_head:${owner}/${repo}`;
}

function getIndexFirstBuiltKey(owner: string, repo: string): string {
    return `index_first_built:${owner}/${repo}`;
}

function getIndexAccessKey(owner: string, repo: string): string {
    return `index_access:${owner}/${repo}`;
}

function encodeIndex(index: RepoIndex): string {
    const json = JSON.stringify(index);
    const compressed = gzipSync(Buffer.from(json));
    return `gz:${compressed.toString("base64")}`;
}

function decodeIndex(value: string): RepoIndex | null {
    try {
        if (value.startsWith("gz:")) {
            const buffer = Buffer.from(value.slice(3), "base64");
            const json = gunzipSync(buffer).toString();
            return JSON.parse(json) as RepoIndex;
        }
        return JSON.parse(value) as RepoIndex;
    } catch (error) {
        console.warn("Failed to decode repo index:", error);
        return null;
    }
}

async function safeKvOperation<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
        return await operation();
    } catch (error) {
        console.warn("Repo index KV operation failed:", error);
        return null;
    }
}

const indexAccessWriteGate = new Map<string, number>();

function shouldWriteIndexAccess(owner: string, repo: string, nowMs: number = Date.now()): boolean {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const lastWriteAt = indexAccessWriteGate.get(key) ?? 0;
    if (nowMs - lastWriteAt < INDEX_ACCESS_THROTTLE_MS) {
        return false;
    }

    indexAccessWriteGate.set(key, nowMs);
    if (indexAccessWriteGate.size > 2_000) {
        const threshold = nowMs - (INDEX_ACCESS_THROTTLE_MS * 4);
        for (const [entryKey, ts] of indexAccessWriteGate.entries()) {
            if (ts < threshold) {
                indexAccessWriteGate.delete(entryKey);
            }
        }
    }
    return true;
}

async function ensureIndexFirstBuilt(owner: string, repo: string): Promise<void> {
    const key = getIndexFirstBuiltKey(owner, repo);
    await safeKvOperation(async () => {
        const existing = await kv.get<number>(key);
        if (!existing) {
            await kv.set(key, Date.now());
        }
    });
}

export async function recordRepoIndexAccess(owner: string, repo: string): Promise<void> {
    if (!shouldWriteIndexAccess(owner, repo)) {
        return;
    }

    const key = getIndexAccessKey(owner, repo);
    await safeKvOperation(async () => {
        const pipeline = kv.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, INDEX_ACCESS_TTL_SECONDS);
        await pipeline.exec();
    });
}

export async function maybeEvictRepoIndex(owner: string, repo: string): Promise<boolean> {
    const firstBuiltKey = getIndexFirstBuiltKey(owner, repo);
    const accessKey = getIndexAccessKey(owner, repo);
    const registryKey = getIndexRegistryKey(owner, repo);
    const headKey = getIndexHeadKey(owner, repo);

    const [firstBuiltRaw, accessCountRaw] = await Promise.all([
        safeKvOperation(() => kv.get<number>(firstBuiltKey)),
        safeKvOperation(() => kv.get<number>(accessKey)),
    ]);

    const firstBuilt = Number(firstBuiltRaw || 0);
    if (!firstBuilt) return false;

    const ageMs = Date.now() - firstBuilt;
    if (ageMs < INDEX_MIN_RETENTION_MS) return false;

    const accessCount = Number(accessCountRaw || 0);
    if (accessCount >= INDEX_EVICT_ACCESS_THRESHOLD) return false;

    const registry = await safeKvOperation(() => kv.smembers(registryKey)) as string[] | null;
    if (!registry || registry.length === 0) {
        await safeKvOperation(async () => {
            const pipeline = kv.pipeline();
            pipeline.del(registryKey);
            pipeline.del(headKey);
            pipeline.del(firstBuiltKey);
            pipeline.del(accessKey);
            await pipeline.exec();
        });
        return true;
    }

    await safeKvOperation(async () => {
        const pipeline = kv.pipeline();
        registry.forEach((key) => pipeline.del(key));
        pipeline.del(registryKey);
        pipeline.del(headKey);
        pipeline.del(firstBuiltKey);
        pipeline.del(accessKey);
        await pipeline.exec();
    });

    return true;
}

export async function buildRepoIndex(
    owner: string,
    repo: string,
    treeSha: string,
    tree: Array<{ path: string; type: string }>
): Promise<RepoIndex | null> {
    if (!treeSha || !tree.length) return null;

    const indexKey = getIndexKey(owner, repo, treeSha);
    const existing = await safeKvOperation(() => kv.get<string>(indexKey));
    if (existing) {
        const decoded = decodeIndex(existing);
        if (decoded) {
            await safeKvOperation(() => kv.setex(getIndexHeadKey(owner, repo), INDEX_TTL_SECONDS, treeSha));
            await ensureIndexFirstBuilt(owner, repo);
            await safeKvOperation(() => kv.sadd(getIndexRegistryKey(owner, repo), indexKey));
            return decoded;
        }
    }

    const entries: RepoIndexEntry[] = [];
    for (const node of tree) {
        if (node.type !== "blob") continue;
        const filename = node.path.split("/").pop() || node.path;
        const tokens = tokenizeText(node.path);
        const filenameTokens = tokenizeText(filename);
        const coreBoost = getCoreBoost(node.path);
        entries.push({ path: node.path, tokens, filenameTokens, coreBoost });
    }

    const index: RepoIndex = {
        version: INDEX_VERSION,
        createdAt: Date.now(),
        entries,
    };

    await maybeEvictRepoIndex(owner, repo);

    await safeKvOperation(async () => {
        const encoded = encodeIndex(index);
        const pipeline = kv.pipeline();
        pipeline.setex(indexKey, INDEX_TTL_SECONDS, encoded);
        pipeline.sadd(getIndexRegistryKey(owner, repo), indexKey);
        pipeline.setex(getIndexHeadKey(owner, repo), INDEX_TTL_SECONDS, treeSha);
        await pipeline.exec();
    });

    await ensureIndexFirstBuilt(owner, repo);
    return index;
}

export async function loadRepoIndex(owner: string, repo: string): Promise<RepoIndex | null> {
    const headSha = await safeKvOperation(() => kv.get<string>(getIndexHeadKey(owner, repo)));
    if (!headSha || typeof headSha !== "string") return null;

    const indexKey = getIndexKey(owner, repo, headSha);
    const raw = await safeKvOperation(() => kv.get<string>(indexKey));
    if (!raw) return null;

    const index = decodeIndex(raw);
    if (!index) return null;

    await recordRepoIndexAccess(owner, repo);
    return index;
}

/**
 * Infer semantic groups that are likely relevant to the query.
 * Used to boost files in matching semantic groups.
 */
function inferSemanticGroupsFromQuery(query: string): Set<string> {
    const lowerQuery = query.toLowerCase();
    const groups = new Set<string>();

    // ML/AI queries
    if (/\b(gemini|openai|llm|model|ai|machine learning|inference|neural|embed)\b/.test(lowerQuery)) {
        groups.add("ml");
    }

    // API queries
    if (/\b(api|endpoint|route|handler|request|response|fetch|call)\b/.test(lowerQuery)) {
        groups.add("api");
    }

    // UI/Component queries
    if (/\b(component|ui|page|view|layout|button|form|render)\b/.test(lowerQuery)) {
        groups.add("ui");
    }

    // Config queries
    if (/\b(config|environment|setup|setting|initialize|init|env)\b/.test(lowerQuery)) {
        groups.add("config");
    }

    return groups;
}

export function searchRepoIndex(query: string, index: RepoIndex): RepoIndexSearchResult {
    const queryTokens = tokenizeText(query);
    if (queryTokens.length === 0) {
        return { files: [], bestScore: 0, scoreThreshold: 0 };
    }

    const scoreThreshold = Math.max(3, Math.ceil(queryTokens.length * 0.6));
    const relevantGroups = inferSemanticGroupsFromQuery(query);
    const scored: Array<{ path: string; score: number }> = [];

    for (const entry of index.entries) {
        if (!entry.tokens.length && !entry.filenameTokens.length) continue;

        const tokenSet = new Set(entry.tokens);
        const filenameSet = new Set(entry.filenameTokens);
        let score = entry.coreBoost;

        for (const token of queryTokens) {
            if (tokenSet.has(token)) score += 1;
            if (filenameSet.has(token)) score += 2;
        }

        // Apply semantic grouping boost
        if (score > 0 && entry.semanticGroup && relevantGroups.has(entry.semanticGroup)) {
            score *= 1.5;  // 50% boost for matching semantic group
        }

        if (score > 0) {
            scored.push({ path: entry.path, score });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    const files = scored.map((entry) => entry.path);
    const bestScore = scored.length > 0 ? scored[0].score : 0;

    return { files, bestScore, scoreThreshold };
}

export async function ensureRepoIndexForTree(
    owner: string,
    repo: string,
    treeSha: string,
    tree: Array<{ path: string; type: string }>
): Promise<void> {
    try {
        await buildRepoIndex(owner, repo, treeSha, tree);
    } catch (error) {
        console.warn("Failed to build repo index:", error);
    }
}

export async function getRepoIndexStatus(
    owner: string,
    repo: string,
    treeSha: string
): Promise<"ready" | "building"> {
    if (!treeSha) return "building";
    const key = getIndexKey(owner, repo, treeSha);
    const existing = await safeKvOperation(() => kv.get<string>(key));
    return existing ? "ready" : "building";
}
