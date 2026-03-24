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
import { ensureRepoIndexForTree } from "@/lib/services/repo-index-service";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

export interface RepoReleaseSnapshot {
  repo: string;
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
}

export interface PullRequestSnapshot {
  repo: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  html_url: string;
  author: string | null;
}

export interface IssueSnapshot {
  repo: string;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  author: string | null;
}

export interface WeeklyCommitPoint {
  weekStart: string;
  total: number;
}

export interface ContributorSnapshot {
  repo: string;
  login: string;
  contributions: number;
  html_url: string;
}

export interface FileHistorySnapshot {
  repo: string;
  path: string;
  sha: string;
  message: string;
  date: string | null;
  author: string | null;
}

export interface CompareRefsSnapshot {
  repo: string;
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  html_url: string;
  commits: Array<{ sha: string; message: string; date: string | null; author: string | null }>;
  files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }>;
}

export interface WorkflowRunSnapshot {
  repo: string;
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  event: string;
  branch: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface RepoLanguageSnapshot {
  repo: string;
  languages: Array<{ name: string; bytes: number; percentage: number }>;
}

export interface DependencyAlertSnapshot {
  repo: string;
  number: number;
  state: string;
  severity: string | null;
  ecosystem: string | null;
  package_name: string | null;
  manifest_path: string | null;
  created_at: string | null;
  html_url: string | null;
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

export async function getRepoFileTree(owner: string, repo: string, branch: string = "main"): Promise<{ tree: FileNode[], hiddenFiles: { path: string; reason: string }[], treeSha: string }> {
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
    return { tree: cachedTree as FileNode[], hiddenFiles: [], treeSha: sha }; // Hidden files not cached separately but that's ok
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
  void ensureRepoIndexForTree(owner, repo, sha, minimalTree);

  return { tree: minimalTree, hiddenFiles, treeSha: sha };
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
    revalidate: 3600, // 60 minutes
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

interface OwnerRepoRef {
  owner: string;
  repo: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function listProfileRepoRefs(username: string, limit: number): Promise<OwnerRepoRef[]> {
  const repos = await getUserRepos(username);
  return repos.slice(0, limit).map((repo) => ({ owner: username, repo: repo.name }));
}

function toIsoWeekStart(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export async function getRepoReleasesSnapshot(
  owner: string,
  repo: string,
  limit: number = 10
): Promise<Result<RepoReleaseSnapshot[]>> {
  try {
    const { data } = await octokit.rest.repos.listReleases({
      owner,
      repo,
      per_page: clamp(limit, 1, 30),
    });
    return {
      success: true,
      data: data.slice(0, clamp(limit, 1, 30)).map((release) => ({
        repo,
        tag_name: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        prerelease: Boolean(release.prerelease),
        draft: Boolean(release.draft),
        html_url: release.html_url,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch releases for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch releases.", status: getErrorStatus(error) };
  }
}

export async function getProfileReleasesSnapshot(
  username: string,
  limit: number = 10,
  repoLimit: number = 8
): Promise<Result<RepoReleaseSnapshot[]>> {
  try {
    const refs = await listProfileRepoRefs(username, clamp(repoLimit, 1, 20));
    const batches = await Promise.all(refs.map(async ({ owner, repo }) => {
      const snapshot = await getRepoReleasesSnapshot(owner, repo, 3);
      return snapshot.success ? snapshot.data : [];
    }));
    const merged = batches.flat().sort((a, b) =>
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime()
    );
    return { success: true, data: merged.slice(0, clamp(limit, 1, 30)) };
  } catch (error) {
    console.error(`Failed to fetch profile releases for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile releases.", status: getErrorStatus(error) };
  }
}

export async function getRepoPullRequestsSnapshot(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "all",
  limit: number = 20,
  since?: string
): Promise<Result<PullRequestSnapshot[]>> {
  try {
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state,
      sort: "updated",
      direction: "desc",
      per_page: clamp(limit, 1, 50),
    });
    const cutoff = since ? new Date(since).getTime() : null;
    const filtered = data.filter((pr) => {
      if (!cutoff || Number.isNaN(cutoff)) return true;
      return new Date(pr.updated_at).getTime() >= cutoff;
    });
    return {
      success: true,
      data: filtered.slice(0, clamp(limit, 1, 50)).map((pr) => ({
        repo,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: Boolean(pr.draft),
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        html_url: pr.html_url,
        author: pr.user?.login ?? null,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch pull requests for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch pull requests.", status: getErrorStatus(error) };
  }
}

export async function getProfilePullRequestsSnapshot(
  username: string,
  state: "open" | "closed" | "all" = "all",
  limit: number = 20,
  since?: string,
  repoLimit: number = 6
): Promise<Result<PullRequestSnapshot[]>> {
  try {
    const refs = await listProfileRepoRefs(username, clamp(repoLimit, 1, 20));
    const eachLimit = clamp(Math.ceil(limit / Math.max(1, refs.length)), 1, 10);
    const batches = await Promise.all(refs.map(async ({ owner, repo }) => {
      const snapshot = await getRepoPullRequestsSnapshot(owner, repo, state, eachLimit, since);
      return snapshot.success ? snapshot.data : [];
    }));
    const merged = batches.flat().sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    return { success: true, data: merged.slice(0, clamp(limit, 1, 50)) };
  } catch (error) {
    console.error(`Failed to fetch profile pull requests for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile pull requests.", status: getErrorStatus(error) };
  }
}

export async function getRepoIssuesSnapshot(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "all",
  limit: number = 20,
  since?: string
): Promise<Result<IssueSnapshot[]>> {
  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state,
      since,
      sort: "updated",
      direction: "desc",
      per_page: clamp(limit, 1, 50),
    });
    const issuesOnly = data.filter((issue) => !issue.pull_request);
    return {
      success: true,
      data: issuesOnly.slice(0, clamp(limit, 1, 50)).map((issue) => ({
        repo,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        html_url: issue.html_url,
        author: issue.user?.login ?? null,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch issues for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch issues.", status: getErrorStatus(error) };
  }
}

export async function getProfileIssuesSnapshot(
  username: string,
  state: "open" | "closed" | "all" = "all",
  limit: number = 20,
  since?: string,
  repoLimit: number = 6
): Promise<Result<IssueSnapshot[]>> {
  try {
    const refs = await listProfileRepoRefs(username, clamp(repoLimit, 1, 20));
    const eachLimit = clamp(Math.ceil(limit / Math.max(1, refs.length)), 1, 10);
    const batches = await Promise.all(refs.map(async ({ owner, repo }) => {
      const snapshot = await getRepoIssuesSnapshot(owner, repo, state, eachLimit, since);
      return snapshot.success ? snapshot.data : [];
    }));
    const merged = batches.flat().sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    return { success: true, data: merged.slice(0, clamp(limit, 1, 50)) };
  } catch (error) {
    console.error(`Failed to fetch profile issues for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile issues.", status: getErrorStatus(error) };
  }
}

async function getRepoCommitActivity(owner: string, repo: string): Promise<WeeklyCommitPoint[]> {
  try {
    const response = await octokit.rest.repos.getCommitActivityStats({ owner, repo });
    const data = response.data;
    if (!Array.isArray(data)) return [];
    return data.map((point) => ({
      weekStart: toIsoWeekStart(point.week),
      total: point.total,
    }));
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 202) {
      return [];
    }
    throw error;
  }
}

export async function getRepoCommitFrequencySnapshot(
  owner: string,
  repo: string,
  weeks: number = 8
): Promise<Result<WeeklyCommitPoint[]>> {
  try {
    const activity = await getRepoCommitActivity(owner, repo);
    const trimmed = activity.slice(-clamp(weeks, 1, 52));
    return { success: true, data: trimmed };
  } catch (error) {
    console.error(`Failed to fetch commit frequency for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch commit frequency.", status: getErrorStatus(error) };
  }
}

export async function getProfileCommitFrequencySnapshot(
  username: string,
  weeks: number = 8,
  repoLimit: number = 6
): Promise<Result<WeeklyCommitPoint[]>> {
  try {
    const refs = await listProfileRepoRefs(username, clamp(repoLimit, 1, 20));
    const series = await Promise.all(refs.map(async ({ owner, repo }) => getRepoCommitActivity(owner, repo)));
    const targetWeeks = clamp(weeks, 1, 52);
    const buckets = new Map<string, number>();

    for (const points of series) {
      const recent = points.slice(-targetWeeks);
      for (const point of recent) {
        buckets.set(point.weekStart, (buckets.get(point.weekStart) ?? 0) + point.total);
      }
    }

    const merged = Array.from(buckets.entries())
      .map(([weekStart, total]) => ({ weekStart, total }))
      .sort((a, b) => new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime())
      .slice(-targetWeeks);

    return { success: true, data: merged };
  } catch (error) {
    console.error(`Failed to fetch profile commit frequency for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile commit frequency.", status: getErrorStatus(error) };
  }
}

export async function getRepoContributorsSnapshot(
  owner: string,
  repo: string,
  limit: number = 20
): Promise<Result<ContributorSnapshot[]>> {
  try {
    const { data } = await octokit.rest.repos.listContributors({
      owner,
      repo,
      per_page: clamp(limit, 1, 50),
    });
    return {
      success: true,
      data: data.slice(0, clamp(limit, 1, 50)).map((contributor) => ({
        repo,
        login: contributor.login ?? "unknown",
        contributions: contributor.contributions ?? 0,
        html_url: contributor.html_url ?? "",
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch contributors for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch contributors.", status: getErrorStatus(error) };
  }
}

export async function getProfileContributorsSnapshot(
  username: string,
  limit: number = 20,
  repoLimit: number = 6
): Promise<Result<ContributorSnapshot[]>> {
  try {
    const refs = await listProfileRepoRefs(username, clamp(repoLimit, 1, 20));
    const eachLimit = clamp(Math.ceil(limit / Math.max(1, refs.length)), 1, 15);
    const batches = await Promise.all(refs.map(async ({ owner, repo }) => {
      const snapshot = await getRepoContributorsSnapshot(owner, repo, eachLimit);
      return snapshot.success ? snapshot.data : [];
    }));
    const aggregate = new Map<string, ContributorSnapshot>();

    for (const contributor of batches.flat()) {
      const key = contributor.login;
      const prev = aggregate.get(key);
      if (!prev) {
        aggregate.set(key, { ...contributor, repo: "multiple" });
      } else {
        prev.contributions += contributor.contributions;
      }
    }

    const merged = Array.from(aggregate.values())
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, clamp(limit, 1, 50));

    return { success: true, data: merged };
  } catch (error) {
    console.error(`Failed to fetch profile contributors for ${username}:`, error);
    return { success: false, error: "Failed to fetch profile contributors.", status: getErrorStatus(error) };
  }
}

export async function getRepoFileHistorySnapshot(
  owner: string,
  repo: string,
  path: string,
  limit: number = 10
): Promise<Result<FileHistorySnapshot[]>> {
  try {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      path,
      per_page: clamp(limit, 1, 30),
    });
    return {
      success: true,
      data: data.slice(0, clamp(limit, 1, 30)).map((commit) => ({
        repo,
        path,
        sha: commit.sha.slice(0, 7),
        message: commit.commit.message,
        date: commit.commit.author?.date ?? null,
        author: commit.author?.login ?? commit.commit.author?.name ?? null,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch file history for ${owner}/${repo}:${path}:`, error);
    return { success: false, error: "Failed to fetch file history.", status: getErrorStatus(error) };
  }
}

export async function compareRepoRefsSnapshot(
  owner: string,
  repo: string,
  base: string,
  head: string,
  commitLimit: number = 20,
  fileLimit: number = 50
): Promise<Result<CompareRefsSnapshot>> {
  try {
    const { data } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base,
      head,
      per_page: clamp(commitLimit, 1, 100),
    });
    return {
      success: true,
      data: {
        repo,
        status: data.status,
        ahead_by: data.ahead_by,
        behind_by: data.behind_by,
        total_commits: data.total_commits,
        html_url: data.html_url,
        commits: (data.commits ?? []).slice(0, clamp(commitLimit, 1, 100)).map((commit) => ({
          sha: commit.sha.slice(0, 7),
          message: commit.commit.message,
          date: commit.commit.author?.date ?? null,
          author: commit.author?.login ?? commit.commit.author?.name ?? null,
        })),
        files: (data.files ?? []).slice(0, clamp(fileLimit, 1, 200)).map((file) => ({
          filename: file.filename,
          status: file.status ?? "modified",
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          changes: file.changes ?? 0,
        })),
      },
    };
  } catch (error) {
    console.error(`Failed to compare refs for ${owner}/${repo} ${base}...${head}:`, error);
    return { success: false, error: "Failed to compare refs.", status: getErrorStatus(error) };
  }
}

export async function getRepoWorkflowRunsSnapshot(
  owner: string,
  repo: string,
  limit: number = 20,
  status?: string,
  branch?: string
): Promise<Result<WorkflowRunSnapshot[]>> {
  try {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: clamp(limit, 1, 50),
      status: status as unknown as "queued" | "in_progress" | "completed" | "action_required" | "cancelled" | "failure" | "neutral" | "skipped" | "stale" | "success" | "timed_out" | "requested" | "waiting" | "pending" | undefined,
      branch,
    });
    return {
      success: true,
      data: (data.workflow_runs ?? []).slice(0, clamp(limit, 1, 50)).map((run) => ({
        repo,
        id: run.id,
        name: run.name ?? null,
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        event: run.event,
        branch: run.head_branch ?? "",
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch workflow runs for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch workflow runs.", status: getErrorStatus(error) };
  }
}

export async function getRepoLanguagesSnapshot(
  owner: string,
  repo: string
): Promise<Result<RepoLanguageSnapshot>> {
  try {
    const { data } = await octokit.rest.repos.listLanguages({ owner, repo });
    const entries = Object.entries(data);
    const total = entries.reduce((sum, [, bytes]) => sum + Number(bytes), 0);
    const languages = entries
      .map(([name, bytes]) => ({
        name,
        bytes: Number(bytes),
        percentage: total > 0 ? Number(((Number(bytes) / total) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      success: true,
      data: {
        repo,
        languages,
      },
    };
  } catch (error) {
    console.error(`Failed to fetch languages for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch repository languages.", status: getErrorStatus(error) };
  }
}

export async function getRepoDependencyAlertsSnapshot(
  owner: string,
  repo: string,
  limit: number = 20
): Promise<Result<DependencyAlertSnapshot[]>> {
  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}/dependabot/alerts", {
      owner,
      repo,
      per_page: clamp(limit, 1, 50),
    });
    const data = Array.isArray(response.data) ? response.data : [];
    return {
      success: true,
      data: data.slice(0, clamp(limit, 1, 50)).map((rawAlert) => {
        const alert = asRecord(rawAlert);
        const advisory = asRecord(alert.security_advisory);
        const dependency = asRecord(alert.dependency);
        const pkg = asRecord(dependency.package);
        return {
          repo,
          number: Number(alert.number ?? 0),
          state: String(alert.state ?? "unknown"),
          severity: String(advisory.severity ?? "") || null,
          ecosystem: String(pkg.ecosystem ?? "") || null,
          package_name: String(pkg.name ?? "") || null,
          manifest_path: String(alert.manifest_path ?? "") || null,
          created_at: String(alert.created_at ?? "") || null,
          html_url: String(alert.html_url ?? "") || null,
        };
      }),
    };
  } catch (error) {
    console.error(`Failed to fetch dependency alerts for ${owner}/${repo}:`, error);
    return { success: false, error: "Failed to fetch dependency alerts.", status: getErrorStatus(error) };
  }
}
