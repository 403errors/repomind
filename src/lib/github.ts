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
} from "./cache";

// Validate GitHub token
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.warn("⚠️ GITHUB_TOKEN environment variable is not set - API rate limits will be very restrictive");
}

const octokit = new Octokit({
  auth: githubToken,
  request: {
    // NOTE: cache:"no-store" disables HTTP caching for all GitHub API calls.
    // This is intentional — it prevents stale data in edge/serverless deployments
    // where the module reloads frequently. Caching is handled at the application
    // layer via KV (see cache.ts) using SHA-based keys for automatic invalidation.
    fetch: (url: string, options: any) => {
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
  stargazers_count: number;
  language: string | null;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  owner: {
    login: string;
  };
  updated_at: string;
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
            history(first: 20) {
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

export async function getProfile(username: string): Promise<GitHubProfile> {
  // Check memory cache first
  if (profileCache.has(username)) {
    return profileCache.get(username)!;
  }

  // Check KV cache
  const cached = await getCachedProfileData(username);
  if (cached) {
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

export async function getRepo(owner: string, repo: string): Promise<GitHubRepo> {
  const cacheKey = `${owner}/${repo}`;

  // Check memory cache
  if (repoCache.has(cacheKey)) {
    return repoCache.get(cacheKey)!;
  }

  // Check KV cache
  const cached = await getCachedRepoMetadata(owner, repo);
  if (cached) {
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
  } catch (e) {
    // If branch fetch fails, try to use the default branch from repo details or just let it fail later
    console.warn("Could not fetch branch details, trying with provided name/sha");
  }

  // Check KV cache for tree
  const cachedTree = await getCachedFileTree(owner, repo, sha);
  if (cachedTree) {
    return { tree: cachedTree, hiddenFiles: [] }; // Hidden files not cached separately but that's ok
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
export async function getRepoDetailsGraphQL(owner: string, repo: string) {
  const { graphql } = await import("@octokit/graphql");

  try {
    const data: any = await graphql(REPO_DETAILS_QUERY, {
      owner,
      name: repo,
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
    });

    const languages = data.repository.languages.edges.map((edge: any) => ({
      name: edge.node.name,
      color: edge.node.color,
      size: edge.size,
      percentage: ((edge.size / data.repository.languages.totalSize) * 100).toFixed(1)
    }));

    const commits = data.repository.defaultBranchRef.target.history.edges.map((edge: any) => ({
      message: edge.node.message,
      date: edge.node.committedDate,
      author: {
        name: edge.node.author.name,
        login: edge.node.author.user?.login,
        avatar: edge.node.author.avatarUrl
      }
    }));

    return {
      languages,
      commits,
      totalSize: data.repository.languages.totalSize
    };
  } catch (error) {
    console.error("GraphQL fetch failed:", error);
    return null;
  }
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  sha?: string
) {
  try {
    // If SHA is provided, check cache directly
    if (sha) {
      const cached = await getCachedFile(owner, repo, path, sha);
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
        await cacheFile(owner, repo, path, sha, content);
        return content;
      } catch (e) {
        console.warn(`Failed to fetch blob for ${path} with SHA ${sha}, falling back to standard fetch`);
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
        const cached = await getCachedFile(owner, repo, path, currentSha);
        if (cached) {
          return cached;
        }
      }

      // Decode content
      const content = Buffer.from(data.content, "base64").toString("utf-8");

      // Cache for future requests
      await cacheFile(owner, repo, path, currentSha, content);

      return content;
    }
    throw new Error("Not a file");
  } catch (error) {
    console.error("Error fetching file content:", error);
    throw error;
  }
}

/**
 * Batch fetch multiple files in parallel with caching
 */
export async function getFileContentBatch(
  owner: string,
  repo: string,
  files: Array<{ path: string; sha?: string }>
): Promise<Array<{ path: string; content: string | null }>> {
  const promises = files.map(async ({ path, sha }) => {
    try {
      const content = await getFileContent(owner, repo, path, sha);
      return { path, content };
    } catch (error) {
      console.warn(`Failed to fetch ${path}:`, error);
      return { path, content: null };
    }
  });

  return await Promise.all(promises);
}

export async function getProfileReadme(username: string) {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner: username,
      repo: username,
    });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error) {
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
  } catch (error) {
    return null;
  }
}

/**
 * Get all public repositories for a user
 */
export async function getUserRepos(username: string): Promise<GitHubRepo[]> {
  try {
    const { data } = await octokit.rest.repos.listForUser({
      username,
      sort: "updated",
      per_page: 100, // Get up to 100 most recent repos
    });
    return data as any;
  } catch (e) {
    console.error("Failed to fetch user repos", e);
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
        };
      } catch (e) {
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
    }[];
  } catch (error) {
    console.error("Error fetching repos:", error);
    return [];
  }
}
