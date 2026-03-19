import { Octokit } from "octokit";
import {
  cacheFile,
  getCachedFile,
  cacheRepoMetadata,
  getCachedRepoMetadata,
  cacheProfileData,
  getCachedProfileData,
  cacheFileTree,
  getCachedFileTree,
  cacheRepoFullContext,
  getCachedRepoFullContext,
  getCachedFilesBatch,
  getCachedProfileCommitSnapshot,
  cacheProfileCommitSnapshot,
  getCachedRepoCommitSnapshot,
  cacheRepoCommitSnapshot,
  type FileCachePolicy,
} from "./cache";
import { unstable_cache } from 'next/cache';

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

interface RepoLanguageEdge {
  size: number;
  node: {
    name: string;
    color: string | null;
  };
}

interface RepoCommitEdge {
  node: {
    message: string;
    committedDate: string;
    author: {
      name: string;
      avatarUrl: string | null;
      user: {
        login: string;
      } | null;
    };
  };
}

interface RepoDetailsGraphQLResponse {
  repository: {
    languages: {
      totalSize: number;
      edges: RepoLanguageEdge[];
    };
    defaultBranchRef: {
      target: {
        history: {
          edges: RepoCommitEdge[];
        };
      };
    };
  };
}

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: number };

export function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as ErrorWithStatus).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function isErrorWithMessage(error: unknown): error is { message: string } {
  return Boolean(
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export function isGitHubProfile(value: unknown): value is GitHubProfile {
  return Boolean(
    value &&
    typeof value === "object" &&
    "login" in value &&
    "avatar_url" in value &&
    "html_url" in value
  );
}

export function isGitHubRepo(value: unknown): value is GitHubRepo {
  return Boolean(
    value &&
    typeof value === "object" &&
    "name" in value &&
    "full_name" in value &&
    "default_branch" in value
  );
}

// Validate GitHub token
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.warn("⚠️ GITHUB_TOKEN environment variable is not set - API rate limits will be very restrictive");
}

export const octokit = new Octokit({
  auth: githubToken,
  request: {
    // NOTE: cache:"no-store" disables HTTP caching for all GitHub API calls.
    // This is intentional — it prevents stale data in edge/serverless deployments
    // where the module reloads frequently. Caching is handled at the application
    // layer via KV (see cache.ts) using SHA-based keys for automatic invalidation.
    fetch: (url: string, options?: RequestInit) => {
      return fetch(url, {
        ...options,
        cache: "no-store",
        next: { revalidate: 0 }
      });
    },
  },
});

// In-memory caches for the current process lifetime.
// NOTE: In Vercel serverless functions these Maps are effectively useless as a
// persistent cache — each cold start initializes fresh Maps. They provide a
// minor speedup within a single warm invocation (e.g., sequential calls in one
// request). The real caching layer is Vercel KV (see cache.ts).
const profileCache = new Map<string, GitHubProfile>();
const repoCache = new Map<string, GitHubRepo>();

export interface GitHubProfile {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  blog: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private?: boolean;
  stargazers_count: number;
  language: string | null;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  owner: {
    login: string;
  };
  updated_at: string;
  created_at?: string;
}

export interface RepoLanguage {
  name: string;
  color: string | null;
  size: number;
  percentage: string;
}

export interface RepoCommit {
  message: string;
  date: string;
  author: {
    name: string;
    login?: string;
    avatar: string | null;
  };
}

export interface RepoFullContext {
  metadata: GitHubRepo;
  languages: RepoLanguage[];
  commits: RepoCommit[];
  readme: string | null;
}

export interface RecentCommitSnapshot {
  repo: string;
  message: string;
  date: string | null;
  sha: string;
}

export interface CommitFreshness {
  fetchedAt: number;
  isCached: boolean;
  ageMinutes: number;
  label: string;
}

export interface FileNode {
  path: string;
  mode?: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url?: string;
}

/**
 * GraphQL query for enhanced repository details (languages, recent commits).
 * Defined at module level rather than inside the calling function
 * to keep constants and queries out of the function body.
 */
const REPO_DETAILS_QUERY = `
  query RepoDetails($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
        totalSize
        edges {
          size
          node {
            name
            color
          }
        }
      }
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 5) {
              edges {
                node {
                  message
                  committedDate
                  author {
                    name
                    avatarUrl
                    user {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Core Profile Fetcher (hit by unstable_cache)
 */
async function getProfileRaw(username: string): Promise<GitHubProfile> {
  // Check memory cache first
  if (profileCache.has(username)) {
    return profileCache.get(username)!;
  }

  // Check KV cache
  const cached = await getCachedProfileData(username);
  if (cached && isGitHubProfile(cached)) {
    profileCache.set(username, cached);
    return cached;
  }

  // Fetch from GitHub
  const { data } = await octokit.rest.users.getByUsername({
    username,
  });

  // Cache in both memory and KV
  profileCache.set(username, data);
  await cacheProfileData(username, data);

  return data;
}

/**
 * EDGE-CACHE: Get Profile with Edge Performance
 */
export const getProfile = unstable_cache(
  async (username: string) => getProfileRaw(username),
  ['github-profile'],
  {
    revalidate: 1800, // 30 minutes
    tags: ['profile']
  }
);

export async function getRepo(owner: string, repo: string): Promise<GitHubRepo> {
  const cacheKey = `${owner}/${repo}`;

  // Check memory cache
  if (repoCache.has(cacheKey)) {
    return repoCache.get(cacheKey)!;
  }

  // Check KV cache
  const cached = await getCachedRepoMetadata(owner, repo);
  if (cached && isGitHubRepo(cached)) {
    repoCache.set(cacheKey, cached);
    return cached;
  }

  // Fetch from GitHub
  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  // Cache in both memory and KV
  repoCache.set(cacheKey, data);
  await cacheRepoMetadata(owner, repo, data);

  return data;
}

/**
 * Fetch latest commit SHA for the repository default branch.
 * Intentionally bypasses app-level metadata cache to keep revision checks fresh.
 */
export async function getDefaultBranchHeadSha(owner: string, repo: string): Promise<string> {
  const { data: repoData } = await octokit.rest.repos.get({
    owner,
    repo,
  });
  const defaultBranch = repoData.default_branch || "main";
  const { data: branchData } = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch: defaultBranch,
  });
  return branchData.commit.sha;
}

export async function getRepoFileTree(owner: string, repo: string, branch: string = "main"): Promise<{ tree: FileNode[], hiddenFiles: { path: string; reason: string }[] }> {
  // Get the tree recursively
  // First, get the branch SHA
  let sha = branch;
  try {
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch,
    });
    sha = branchData.commit.sha;
  } catch {
    // If branch fetch fails, try to use the default branch from repo details or just let it fail later
    console.warn("Could not fetch branch details, trying with provided name/sha");
  }

  // Check KV cache for tree
  const cachedTree = await getCachedFileTree(owner, repo, sha);
  if (cachedTree) {
    return { tree: cachedTree as FileNode[], hiddenFiles: [] }; // Hidden files not cached separately but that's ok
  }

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: "true",
  });

  const hiddenFiles: { path: string; reason: string }[] = [];

  const filteredTree = (data.tree as FileNode[]).filter((node) => {
    const path = node.path;

    // Basic exclusions
    if (path.startsWith(".git/") || path === ".git") {
      hiddenFiles.push({ path, reason: "Git System Directory" });
      return false;
    }
    if (path.startsWith("node_modules/") || path === "node_modules") {
      hiddenFiles.push({ path, reason: "Dependencies" });
      return false;
    }
    if (path.startsWith(".next/") || path === ".next") {
      hiddenFiles.push({ path, reason: "Next.js Build Output" });
      return false;
    }
    if (path.startsWith(".idx/") || path === ".idx") {
      hiddenFiles.push({ path, reason: "Project Index" });
      return false;
    }
    if (path.startsWith(".vscode/") || path === ".vscode") {
      hiddenFiles.push({ path, reason: "VS Code Configuration" });
      return false;
    }
    if (path.endsWith(".DS_Store")) {
      hiddenFiles.push({ path, reason: "macOS System File" });
      return false;
    }

    return true;
  });

  // Create a minimal tree for caching/usage to save space
  // We strip 'url' (large string) and 'mode' (unused)
  const minimalTree = filteredTree.map(node => ({
    path: node.path,
    type: node.type,
    sha: node.sha,
    size: node.size
  }));

  // Cache the minimal tree
  await cacheFileTree(owner, repo, sha, minimalTree);

  return { tree: minimalTree, hiddenFiles };
}

/**
 * Fetch enhanced repository details using GraphQL
 */
export async function getRepoDetailsGraphQL(owner: string, repo: string): Promise<Result<{ languages: RepoLanguage[], commits: RepoCommit[], totalSize: number }>> {
  const { graphql } = await import("@octokit/graphql");

  try {
    const data = await graphql<RepoDetailsGraphQLResponse>(REPO_DETAILS_QUERY, {
      owner,
      name: repo,
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
    });

    const languages = data.repository.languages.edges.map((edge) => ({
      name: edge.node.name,
      color: edge.node.color,
      size: edge.size,
      percentage: ((edge.size / data.repository.languages.totalSize) * 100).toFixed(1)
    }));

    const commits = data.repository.defaultBranchRef.target.history.edges.map((edge) => ({
      message: edge.node.message,
      date: edge.node.committedDate,
      author: {
        name: edge.node.author.name,
        login: edge.node.author.user?.login,
        avatar: edge.node.author.avatarUrl
      }
    }));

    return {
      success: true,
      data: {
        languages,
        commits,
        totalSize: data.repository.languages.totalSize
      }
    };
  } catch (error) {
    // TODO: Replace with robust logger
    // logger.error("GraphQL fetch failed", { owner, repo, error });
    console.error("GraphQL fetch failed:", error);
    return { success: false, error: "Failed to fetch repository details from GitHub" };
  }
}

/**
 * Core Repo Context Fetcher (hit by unstable_cache)
 */
async function getRepoFullContextRaw(owner: string, repo: string): Promise<Result<RepoFullContext>> {
  // Check Mega-Key cache first
  const cached = await getCachedRepoFullContext(owner, repo);
  if (cached && isGitHubRepo(cached.metadata)) {
    // Put into memory caches for efficiency if needed
    repoCache.set(`${owner}/${repo}`, cached.metadata);
    return {
      success: true,
      data: {
        metadata: cached.metadata,
        languages: Array.isArray(cached.languages) ? (cached.languages as RepoLanguage[]) : [],
        commits: Array.isArray(cached.commits) ? (cached.commits as RepoCommit[]) : [],
        readme: typeof cached.readme === "string" ? cached.readme : null
      }
    };
  }

  try {
    // Fetch all in parallel
  const [metadata, details, readme] = await Promise.all([
    getRepo(owner, repo),
    getRepoDetailsGraphQL(owner, repo),
    getRepoReadme(owner, repo)
  ]);

  const context: RepoFullContext = {
    metadata,
    languages: details.success ? details.data.languages : [],
    commits: details.success ? details.data.commits : [],
    readme
  };

  // Cache as Mega-Key
  await cacheRepoFullContext(owner, repo, context);

  return { success: true, data: context };
  } catch (error) {
    // TODO: Replace with robust logger
    console.error("Failed to load repo full context:", error);
    const status = getErrorStatus(error);
    return { success: false, error: "Failed to load repository.", status };
  }
}

/**
 * EDGE-CACHE: Get Full Repo Context with Edge Performance
 */
export const getRepoFullContext = unstable_cache(
  async (owner: string, repo: string) => getRepoFullContextRaw(owner, repo),
  ['github-repo-full'],
  {
    revalidate: 900, // 15 minutes
    tags: ['repo-full']
  }
);

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  sha?: string,
  fileCachePolicy?: FileCachePolicy
) {
  try {
    // If SHA is provided, check cache directly
    if (sha) {
      const cached = await getCachedFile(owner, repo, path, sha, fileCachePolicy);
      if (cached) {
        return cached;
      }
    }

    // If no SHA provided, or not in cache, we need to fetch
    // If we have SHA, we can try to fetch blob directly if we want, 
    // but using getContent with path is safer as it handles encoding.
    // However, getContent with path fetches metadata first.
    // If we have SHA, we can use git.getBlob which is faster and doesn't need metadata?
    // Actually, getBlob returns base64. 

    // Let's stick to the existing flow but use SHA to skip metadata fetch if possible.
    // Wait, if we have SHA, we can't skip metadata fetch if we use `repos.getContent` because that endpoint returns metadata + content.
    // BUT, `repos.getContent` IS the metadata fetch.
    // If we have SHA, we can use `git.getBlob`!

    if (sha) {
      try {
        const { data } = await octokit.rest.git.getBlob({
          owner,
          repo,
          file_sha: sha,
        });

        const content = Buffer.from(data.content, "base64").toString("utf-8");
        await cacheFile(owner, repo, path, sha, content, fileCachePolicy);
        return content;
      } catch (error: unknown) {
        const status = getErrorStatus(error);
        if (status !== 404 && status !== 422) {
          console.warn(`Failed to fetch blob for ${path} with SHA ${sha}, falling back to standard fetch`);
        }
      }
    }

    // Fallback or original flow: get the file metadata to obtain SHA
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    });

    if ("content" in data && !Array.isArray(data)) {
      const currentSha = data.sha;

      // Check KV cache with SHA (if we didn't have it before)
      if (!sha) {
        const cached = await getCachedFile(owner, repo, path, currentSha, fileCachePolicy);
        if (cached) {
          return cached;
        }
      }

      // Decode content
      const content = Buffer.from(data.content, "base64").toString("utf-8");

      // Cache for future requests
      await cacheFile(owner, repo, path, currentSha, content, fileCachePolicy);

      return content;
    }
    throw new Error("Not a file");
  } catch (error: unknown) {
    if (!isErrorWithMessage(error) || error.message !== "Not a file") {
      console.error("Error fetching file content:", error);
    }
    throw error;
  }
}

/**
 * Batch fetch multiple files in parallel with caching
 */
export async function getFileContentBatch(
  owner: string,
  repo: string,
  files: Array<{ path: string; sha?: string }>,
  fileCachePolicy?: FileCachePolicy
): Promise<Array<{ path: string; content: string | null }>> {
  const result = await getFileContentBatchWithStats(owner, repo, files, fileCachePolicy);
  return result.files;
}

export interface FileBatchFetchStats {
  requested: number;
  cacheHits: number;
  fetchedFromGitHub: number;
  failed: number;
}

export async function getFileContentBatchWithStats(
  owner: string,
  repo: string,
  files: Array<{ path: string; sha?: string }>,
  fileCachePolicy?: FileCachePolicy
): Promise<{ files: Array<{ path: string; content: string | null }>; stats: FileBatchFetchStats }> {
  // Step 1: Separate files that already have SHAs (eligible for batch cache hit)
  const filesWithSha = files.filter(f => !!f.sha) as Array<{ path: string; sha: string }>;
  const filesWithoutSha = files.filter(f => !f.sha);

  // Step 2: Batch fetch from KV for files with SHAs
  const cachedContents = await getCachedFilesBatch(owner, repo, filesWithSha, fileCachePolicy);

  const results: Array<{ path: string; content: string | null }> = [];
  const missingFromCache: Array<{ path: string; sha: string }> = [];

  // Map results back
  filesWithSha.forEach((file, i) => {
    if (cachedContents[i]) {
      results.push({ path: file.path, content: cachedContents[i] });
    } else {
      missingFromCache.push(file);
    }
  });

  // Step 3: Fetch remaining files (those without SHA or missing from cache)
  // We process these in parallel as before, but the number should be much smaller now
  const remainingFiles = [...filesWithoutSha, ...missingFromCache];
  const remainingPromises = remainingFiles.map(async ({ path, sha }) => {
    try {
      const content = await getFileContent(owner, repo, path, sha, fileCachePolicy);
      return { path, content };
    } catch (error: unknown) {
      if (!isErrorWithMessage(error) || error.message !== "Not a file") {
        console.warn(`Failed to fetch ${path}:`, error);
      }
      return { path, content: null };
    }
  });

  const remainingResults = await Promise.all(remainingPromises);
  const allResults = [...results, ...remainingResults];
  const stats: FileBatchFetchStats = {
    requested: files.length,
    cacheHits: results.length,
    fetchedFromGitHub: remainingFiles.length,
    failed: allResults.filter((entry) => !entry.content).length,
  };
  return { files: allResults, stats };
}

export async function getProfileReadme(username: string) {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner: username,
      repo: username,
    });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function getRepoReadme(owner: string, repo: string) {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
    });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Get all public repositories for a user
 * EDGE-CACHE: Fetches up to 100 most recent repos
 */
export const getUserRepos = unstable_cache(
  async (username: string): Promise<GitHubRepo[]> => {
      const { data } = await octokit.rest.repos.listForUser({
        username,
        sort: "updated",
        per_page: 100,
      });
      return data as unknown as GitHubRepo[];
  },
  ['github-user-repos'],
  {
    revalidate: 3600, // 1 hour
    tags: ['user-repos']
  }
);

/**
 * Get public starred repositories for a user
 */
export async function getStarredRepos(username: string): Promise<GitHubRepo[]> {
  try {
    const { data } = await octokit.rest.activity.listReposStarredByUser({
      username,
      sort: "created",
      per_page: 50,
    });
    return data as unknown as GitHubRepo[];
  } catch (e) {
    console.error("Failed to fetch starred repos", e);
    return [];
  }
}

/**
 * Get READMEs for a user's repositories
 */
export async function getReposReadmes(username: string) {
  try {
    const repos = await getUserRepos(username);

    const readmePromises = repos.map(async (repo) => {
      try {
        const { data } = await octokit.rest.repos.getReadme({
          owner: username,
          repo: repo.name,
        });
        return {
          repo: repo.name,
          content: Buffer.from(data.content, "base64").toString("utf-8"),
          updated_at: repo.updated_at,
          description: repo.description,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language,
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(readmePromises);
    return results.filter((r) => r !== null) as {
      repo: string;
      content: string;
      updated_at: string;
      description: string | null;
      stars: number;
      forks: number;
      language: string | null;
    }[];
  } catch (error) {
    console.error("Error fetching repos:", error);
    return [];
  }
}

/**
 * Get recent commits authored by a specific user across a list of their repositories.
 * Useful for determining qualitative traits like commit quality, coding style, and habits.
 */
export async function getRecentCommitsForUser(username: string, repos: string[], maxTokens: number = 30) {
  try {
    const commitsPromises = repos.slice(0, 10).map(async (repo) => {
      try {
        const { data } = await octokit.rest.repos.listCommits({
          owner: username,
          repo,
          per_page: 5,
        });
        return data.map(commit => ({
          repo,
          message: commit.commit.message,
          date: commit.commit.author?.date,
          sha: commit.sha.substring(0, 7)
        }));
      } catch {
        return [];
      }
    });

    const results = await Promise.all(commitsPromises);
    const flatCommits = results.flat().sort((a, b) => {
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    });

    return flatCommits.slice(0, maxTokens);
  } catch (error) {
    console.error(`Failed to fetch recent commits for ${username}:`, error);
    return [];
  }
}

function toFreshness(fetchedAt: number, isCached: boolean): CommitFreshness {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - fetchedAt) / 60000));
  return {
    fetchedAt,
    isCached,
    ageMinutes,
    label: ageMinutes <= 0 ? "just now" : `cached ${ageMinutes} min ago`,
  };
}

export async function getRecentProfileCommitsSnapshot(
  username: string,
  limit: number = 20
): Promise<Result<{ commits: RecentCommitSnapshot[]; freshness: CommitFreshness }>> {
  const cached = await getCachedProfileCommitSnapshot<RecentCommitSnapshot[]>(username, limit);
  if (cached) {
    return {
      success: true,
      data: {
        commits: cached.data,
        freshness: toFreshness(cached.fetchedAt, true),
      }
    };
  }

  try {
    const repos = await getUserRepos(username);
    console.log(`[getRecentProfileCommitsSnapshot] Fetching commits for ${repos.length} repos (limit ${limit})...`);
    const commits = await getRecentCommitsForUser(
      username,
      repos.map((repo) => repo.name),
      limit
    );
    console.log(`[getRecentProfileCommitsSnapshot] Found ${commits.length} total commits.`);

    const normalized: RecentCommitSnapshot[] = commits.slice(0, limit).map((commit) => ({
      repo: String(commit.repo ?? ""),
      message: String(commit.message ?? ""),
      date: typeof commit.date === "string" ? commit.date : null,
      sha: String(commit.sha ?? "").slice(0, 7),
    }));

    await cacheProfileCommitSnapshot(username, limit, normalized);

    return {
      success: true,
      data: {
        commits: normalized,
        freshness: toFreshness(Date.now(), false),
      }
    };
  } catch (error) {
    // TODO: Replace with robust logger
    console.error(`Failed to fetch profile commits for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile commits.", status: getErrorStatus(error) };
  }
}

export async function getRecentRepoCommitsSnapshot(
  owner: string,
  repo: string,
  limit: number = 10
): Promise<Result<{ commits: RecentCommitSnapshot[]; freshness: CommitFreshness }>> {
  const cached = await getCachedRepoCommitSnapshot<RecentCommitSnapshot[]>(owner, repo, limit);
  if (cached) {
    return {
      success: true,
      data: {
        commits: cached.data,
        freshness: toFreshness(cached.fetchedAt, true),
      }
    };
  }

  try {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: limit,
    });

    const commits: RecentCommitSnapshot[] = data.slice(0, limit).map((commit) => ({
      repo,
      message: commit.commit.message,
      date: commit.commit.author?.date ?? null,
      sha: commit.sha.slice(0, 7),
    }));

    await cacheRepoCommitSnapshot(owner, repo, limit, commits);
    return {
      success: true,
      data: {
        commits,
        freshness: toFreshness(Date.now(), false),
      }
    };
  } catch (error) {
    // TODO: Replace with robust logger
    console.error(`Failed to fetch recent commits for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch repository commits.", status: getErrorStatus(error) };
  }
}

/**
 * Get repositories for a user sorted by creation date.
 * Useful for building a timeline of the user's technology evolution.
 */
export async function getUserReposByAge(username: string, sortDirection: 'oldest' | 'newest' = 'oldest', limit: number = 10) {
  try {
    // We already have getUserRepos which fetches up to 100 recent repos.
    // However, to get the absolute oldest, we should use the standard fetch but sort appropriately.
    const { data } = await octokit.rest.repos.listForUser({
      username,
      sort: "created",
      direction: sortDirection === 'oldest' ? 'asc' : 'desc',
      per_page: limit,
    });

    return data.map(r => ({
      name: r.name,
      description: r.description,
      language: r.language,
      created_at: r.created_at,
      stargazers_count: r.stargazers_count,
    }));
  } catch (error) {
    console.error(`Failed to fetch repos by age for ${username}:`, error);
    return [];
  }
}
