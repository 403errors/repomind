import fs from "node:fs";
import path from "node:path";

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("❌ GITHUB_TOKEN environment variable is required.");
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const skipAllTime = args.includes('--skip-all-time') || process.env.SKIP_ALL_TIME === 'true';

// Configuration for tiered repository catalog with trending algorithm
const TIER_CONFIGS = [
  {
    tier: 'all-time',
    target: 4000,
    windows: [
      { query: "is:public archived:false stars:>=50000", sort: "stars" },
      { query: "is:public archived:false stars:20000..49999", sort: "stars" },
      { query: "is:public archived:false stars:10000..19999", sort: "stars" },
      { query: "is:public archived:false stars:5000..9999", sort: "stars" },
      { query: "is:public archived:false stars:2000..4999", sort: "stars" },
    ],
    useTrendingScore: false,
    description: 'All-time popular repositories (run every 5 years)'
  },
  {
    tier: 'yearly',
    target: 2000,
    windows: [
      { query: `is:public archived:false pushed:>=${daysAgoIso(365)} stars:>=500`, sort: "updated" }
    ],
    useTrendingScore: true,
    trendingWeight: { starVelocity: 0.4, recentStars: 0.3, pushRecency: 0.3 },
    description: 'Trending repositories over the past year'
  },
  {
    tier: '6-month',
    target: 800,
    windows: [
      { query: `is:public archived:false pushed:>=${daysAgoIso(180)} stars:>=200`, sort: "updated" }
    ],
    useTrendingScore: true,
    trendingWeight: { starVelocity: 0.4, recentStars: 0.3, pushRecency: 0.3 },
    description: 'Trending repositories over the past 6 months'
  },
  {
    tier: 'monthly',
    target: 500,
    windows: [
      { query: `is:public archived:false pushed:>=${daysAgoIso(30)} stars:>=100`, sort: "updated" }
    ],
    useTrendingScore: true,
    trendingWeight: { starVelocity: 0.5, recentStars: 0.3, pushRecency: 0.2 },
    description: 'Hot trending repositories this month'
  },
  {
    tier: 'weekly',
    target: 300,
    windows: [
      { query: `is:public archived:false pushed:>=${daysAgoIso(7)} stars:>=50`, sort: "updated" }
    ],
    useTrendingScore: true,
    trendingWeight: { starVelocity: 0.6, recentStars: 0.3, pushRecency: 0.1 },
    description: 'Hottest trending repositories this week'
  }
];

function daysAgoIso(days) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

const SLEEP_MS = 1000;
const PER_PAGE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(query, sort, page) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "RepoMind-Tiered-Catalog",
    },
  });

  if (response.status === 403) {
    const reset = response.headers.get("x-ratelimit-reset");
    const waitMs = reset ? Math.max(0, (Number(reset) * 1000) - Date.now()) : 60000;
    console.warn(`⏳ Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
    await sleep(waitMs + 1000);
    return fetchPage(query, sort, page);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.items || [];
}

/**
 * Calculate trending score for a repository
 *
 * Formula combines:
 * - Star velocity: stars per day since creation
 * - Recent activity: recency of last push
 * - Growth momentum: relative star gain
 *
 * @param {object} repo - Repository object from GitHub API
 * @param {object} weights - Weight distribution for scoring factors
 * @param {number} tierDays - Time window for this tier (7, 30, 180, 365 days)
 */
function calculateTrendingScore(repo, weights, tierDays) {
  const now = Date.now();
  const createdAt = new Date(repo.created_at).getTime();
  const pushedAt = new Date(repo.pushed_at).getTime();

  const daysSinceCreation = Math.max(1, (now - createdAt) / (1000 * 60 * 60 * 24));
  const daysSincePush = Math.max(0.1, (now - pushedAt) / (1000 * 60 * 60 * 24));

  // Star velocity: stars per day since creation
  const starVelocity = repo.stargazers_count / daysSinceCreation;

  // Push recency score: higher for more recent pushes, normalized to 0-1
  const pushRecencyScore = Math.exp(-daysSincePush / tierDays);

  // Estimate recent star gain (heuristic based on activity)
  // Repositories with recent pushes and good star velocity likely gained stars recently
  const recentStarEstimate = starVelocity * pushRecencyScore * tierDays;

  // Normalize components
  const starVelocityNorm = Math.log10(starVelocity + 1);
  const recentStarNorm = Math.log10(recentStarEstimate + 1);

  // Calculate weighted trending score
  const trendingScore =
    (starVelocityNorm * weights.starVelocity) +
    (recentStarNorm * weights.recentStars) +
    (pushRecencyScore * weights.pushRecency * 10); // Scale up recency to balance

  return trendingScore;
}

function normalizeRepo(repo, tier, rank, trendingScore = null) {
  return {
    owner: repo?.owner?.login ?? "",
    repo: repo?.name ?? "",
    stars: Number(repo?.stargazers_count ?? 0),
    description: typeof repo?.description === "string" ? repo.description : null,
    topics: Array.isArray(repo?.topics) ? repo.topics : [],
    language: repo?.language ?? null,
    tier,
    rank,
    ...(trendingScore !== null && { trendingScore: Math.round(trendingScore * 100) / 100 })
  };
}

async function run() {
  const collected = [];
  const seen = new Set();
  let globalRank = 1;

  console.log("🚀 Starting Tiered Repository Catalog Fetch with Trending Algorithm...");

  if (skipAllTime) {
    console.log("⏭️  Skipping all-time tier (preserving existing data)");
    // Load existing data to preserve all-time tier
    const dataPath = path.resolve(process.cwd(), "public/data/top-repos.json");
    if (fs.existsSync(dataPath)) {
      const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const allTimeRepos = existing.filter(r => r.tier === 'all-time');
      console.log(`   📦 Loaded ${allTimeRepos.length} existing all-time repos`);
      collected.push(...allTimeRepos);
      allTimeRepos.forEach(repo => {
        seen.add(`${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`);
      });
      globalRank = Math.max(...allTimeRepos.map(r => r.rank || 0), 0) + 1;
    }
  }

  console.log("📊 Configuration:");
  TIER_CONFIGS.forEach(config => {
    if (skipAllTime && config.tier === 'all-time') {
      console.log(`   ${config.tier}: SKIPPED - ${config.description}`);
    } else {
      console.log(`   ${config.tier}: ${config.target} repos - ${config.description}`);
    }
  });

  for (const config of TIER_CONFIGS) {
    if (skipAllTime && config.tier === 'all-time') {
      console.log(`\n📦 Tier: ${config.tier} - SKIPPED`);
      continue;
    }

    console.log(`\n📦 Tier: ${config.tier} (Target: ${config.target})`);
    let tierCollectedCount = 0;
    const tierRepos = [];

    for (const window of config.windows) {
      if (tierCollectedCount >= config.target) break;

      // Fetch more repos than needed for trending tiers to allow for scoring/sorting
      const fetchMultiplier = config.useTrendingScore ? 2 : 1;
      const maxPages = Math.min(10, Math.ceil((config.target * fetchMultiplier) / PER_PAGE));

      for (let page = 1; page <= maxPages; page++) {
        console.log(`   🔍 Fetching ${config.tier} - ${window.query.slice(0, 50)}... (Page ${page})`);
        try {
          const items = await fetchPage(window.query, window.sort, page);
          if (!items.length) break;

          for (const item of items) {
            const key = `${item.owner.login.toLowerCase()}/${item.name.toLowerCase()}`;
            if (seen.has(key)) continue;

            if (config.useTrendingScore) {
              // Calculate trending score for sorting
              const tierDays = config.tier === 'weekly' ? 7 :
                               config.tier === 'monthly' ? 30 :
                               config.tier === '6-month' ? 180 : 365;
              const score = calculateTrendingScore(item, config.trendingWeight, tierDays);
              tierRepos.push({ item, key, score });
            } else {
              // For all-time tier, add directly
              seen.add(key);
              collected.push(normalizeRepo(item, config.tier, globalRank++));
              tierCollectedCount++;

              if (tierCollectedCount >= config.target) break;
            }
          }

          await sleep(SLEEP_MS);
        } catch (err) {
          console.error(`   ❌ Error: ${err.message}`);
          break;
        }
      }
    }

    // For trending tiers, sort by trending score and take top N
    if (config.useTrendingScore && tierRepos.length > 0) {
      console.log(`   📈 Calculating trending scores for ${tierRepos.length} candidates...`);

      // Sort by trending score descending
      tierRepos.sort((a, b) => b.score - a.score);

      // Take top repos up to target
      const topRepos = tierRepos.slice(0, config.target);

      for (const { item, key, score } of topRepos) {
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(normalizeRepo(item, config.tier, globalRank++, score));
          tierCollectedCount++;
        }
      }

      if (topRepos.length > 0) {
        console.log(`   📊 Top trending score: ${topRepos[0].score.toFixed(2)}`);
        console.log(`   📊 Median trending score: ${topRepos[Math.floor(topRepos.length/2)].score.toFixed(2)}`);
      }
    }

    console.log(`   ✅ Finished ${config.tier}: +${tierCollectedCount} repos`);

    // Save progress after each tier
    const dataDir = path.resolve(process.cwd(), "public/data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const outputPath = path.join(dataDir, "top-repos.json");
    fs.writeFileSync(outputPath, JSON.stringify(collected, null, 2));
    console.log(`   💾 Progress saved to ${outputPath}`);
  }

  const dataDir = path.resolve(process.cwd(), "public/data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const outputPath = path.join(dataDir, "top-repos.json");
  fs.writeFileSync(outputPath, JSON.stringify(collected, null, 2));

  console.log(`\n🎉 Process complete! Total repos: ${collected.length}`);
  const tierStats = collected.reduce((acc, repo) => {
    acc[repo.tier] = (acc[repo.tier] || 0) + 1;
    return acc;
  }, {});
  Object.entries(tierStats).forEach(([tier, count]) => {
    console.log(`   🔸 ${tier}: ${count} repos`);
  });
  console.log(`📄 Saved to ${outputPath}`);

  // Show some trending examples
  console.log(`\n🔥 Sample trending repositories:`);
  const trendingRepos = collected.filter(r => r.trendingScore).slice(0, 5);
  trendingRepos.forEach(repo => {
    console.log(`   • ${repo.owner}/${repo.repo} (${repo.stars}⭐, trending: ${repo.trendingScore})`);
  });
}

run().catch(console.error);
