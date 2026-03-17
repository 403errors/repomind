import fs from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";

const REPO_LIMIT = 7600;
const TOPIC_INDEX_LIMIT = 2000;
const TOPIC_MIN_REPO_COUNT = 20;
const TOPIC_REPO_LIST_LIMIT = 50;

export type RepoTier = 'all-time' | 'yearly' | '6-month' | 'monthly' | 'weekly';

export interface CatalogRepoEntry {
  owner: string;
  repo: string;
  stars: number;
  description: string | null;
  topics: string[];
  language: string | null;
  tier?: RepoTier;
  rank?: number;
}

interface CatalogData {
  curatedRepos: CatalogRepoEntry[];
  curatedRepoKeys: string[];
  indexableTopics: string[];
}

function isCatalogRepoEntry(value: unknown): value is CatalogRepoEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CatalogRepoEntry>;

  return (
    typeof item.owner === "string" &&
    typeof item.repo === "string" &&
    typeof item.stars === "number" &&
    Array.isArray(item.topics)
  );
}

function normalizeRepo(entry: CatalogRepoEntry): CatalogRepoEntry {
  return {
    owner: entry.owner.trim(),
    repo: entry.repo.trim(),
    stars: entry.stars,
    description: entry.description,
    topics: entry.topics
      .filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
      .map((topic) => topic.toLowerCase()),
    language: entry.language,
    tier: entry.tier,
    rank: entry.rank,
  };
}

function toRepoKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function buildCatalogData(repos: CatalogRepoEntry[]): CatalogData {
  const deduped: CatalogRepoEntry[] = [];
  const seenRepoKeys = new Set<string>();

  for (const repo of repos) {
    const normalized = normalizeRepo(repo);
    if (!normalized.owner || !normalized.repo) continue;

    const key = toRepoKey(normalized.owner, normalized.repo);
    if (seenRepoKeys.has(key)) continue;

    seenRepoKeys.add(key);
    deduped.push(normalized);
  }

  const curatedRepos = deduped.slice(0, REPO_LIMIT);
  const curatedRepoKeys = curatedRepos.map((repo) => toRepoKey(repo.owner, repo.repo));

  const topicBuckets: Record<string, CatalogRepoEntry[]> = {};
  const topicFrequency: Record<string, { allTime: number; trending: number }> = {};

  for (const repo of curatedRepos) {
    const uniqueTopics = new Set(repo.topics);
    const isTrending = repo.tier === 'weekly' || repo.tier === 'monthly' || repo.tier === '6-month';

    for (const topic of uniqueTopics) {
      if (!topicBuckets[topic]) {
        topicBuckets[topic] = [];
        topicFrequency[topic] = { allTime: 0, trending: 0 };
      }
      topicBuckets[topic].push(repo);
      
      if (repo.tier === 'all-time') {
        topicFrequency[topic].allTime++;
      }
      if (isTrending) {
        topicFrequency[topic].trending++;
      }
    }
  }

  // Topic Strategy: 1500 Trending + 500 Stable
  const eligibleTopics = Object.entries(topicBuckets)
    .filter(([_, reposForTopic]) => reposForTopic.length >= TOPIC_MIN_REPO_COUNT)
    .map(([topic]) => topic);

  const stableTopics = [...eligibleTopics]
    .sort((a, b) => topicFrequency[b].allTime - topicFrequency[a].allTime)
    .slice(0, 500);

  const remainingTopics = eligibleTopics.filter(t => !stableTopics.includes(t));
  
  const trendingTopics = remainingTopics
    .sort((a, b) => topicFrequency[b].trending - topicFrequency[a].trending)
    .slice(0, 1500);

  const indexableTopics = [...stableTopics, ...trendingTopics].sort();

  return {
    curatedRepos,
    curatedRepoKeys,
    indexableTopics,
  };
}

const getCatalogData = unstable_cache(
  async (): Promise<CatalogData> => {
    try {
      const dataPath = path.join(process.cwd(), "public", "data", "top-repos.json");
      if (!fs.existsSync(dataPath)) {
        return buildCatalogData([]);
      }

      const fileContent = await fs.promises.readFile(dataPath, "utf8");
      const parsed = JSON.parse(fileContent) as unknown;
      const repos = Array.isArray(parsed) ? parsed.filter(isCatalogRepoEntry) : [];

      return buildCatalogData(repos);
    } catch (error) {
      console.error("Failed to load repo catalog data:", error);
      return buildCatalogData([]);
    }
  },
  ["repo-catalog-data-v1"],
  {
    revalidate: 604800,
    tags: ["repo-catalog"],
  }
);

export async function getCuratedRepos(tier?: RepoTier): Promise<CatalogRepoEntry[]> {
  const data = await getCatalogData();
  if (tier) {
    return data.curatedRepos.filter(repo => repo.tier === tier);
  }
  return data.curatedRepos;
}

export async function isCuratedRepo(owner: string, repo: string): Promise<boolean> {
  const data = await getCatalogData();
  const key = toRepoKey(owner, repo);
  return data.curatedRepoKeys.includes(key);
}

export async function getReposForTopic(topic: string): Promise<CatalogRepoEntry[]> {
  const data = await getCatalogData();
  const normalizedTopic = topic.toLowerCase();
  const repos = data.curatedRepos.filter((repo) => repo.topics.includes(normalizedTopic));
  repos.sort((a, b) => b.stars - a.stars);
  return repos.slice(0, TOPIC_REPO_LIST_LIMIT);
}

export async function getIndexableTopics(): Promise<string[]> {
  const data = await getCatalogData();
  return data.indexableTopics;
}

export async function isIndexableTopic(topic: string): Promise<boolean> {
  const data = await getCatalogData();
  return data.indexableTopics.includes(topic.toLowerCase());
}

export async function getCatalogStats() {
  const data = await getCatalogData();
  const tierCounts: Record<string, number> = {
    'all-time': 0,
    'yearly': 0,
    '6-month': 0,
    'monthly': 0,
    'weekly': 0,
  };

  data.curatedRepos.forEach(repo => {
    if (repo.tier) tierCounts[repo.tier]++;
  });

  return {
    totalRepos: data.curatedRepos.length,
    totalTopics: data.indexableTopics.length,
    tierCounts
  };
}
