#!/usr/bin/env node

/**
 * Test script for trending algorithm validation
 *
 * This script validates the trending score calculation without making API calls.
 */

// Mock repository data for testing
const testRepos = [
  {
    name: "very-new-hot-repo",
    stargazers_count: 1000,
    created_at: "2026-03-10T00:00:00Z", // 7 days ago
    pushed_at: "2026-03-16T00:00:00Z",  // 1 day ago
    expected: "Very high trending score (new + active + high velocity)"
  },
  {
    name: "old-stable-repo",
    stargazers_count: 50000,
    created_at: "2015-01-01T00:00:00Z", // ~11 years ago
    pushed_at: "2026-03-16T00:00:00Z",  // 1 day ago (recently active)
    expected: "Moderate trending score (old but active)"
  },
  {
    name: "stagnant-repo",
    stargazers_count: 10000,
    created_at: "2020-01-01T00:00:00Z", // ~6 years ago
    pushed_at: "2025-01-01T00:00:00Z",  // 75 days ago (inactive)
    expected: "Low trending score (inactive)"
  },
  {
    name: "rapid-growth-repo",
    stargazers_count: 5000,
    created_at: "2026-02-01T00:00:00Z", // 44 days ago
    pushed_at: "2026-03-17T00:00:00Z",  // today
    expected: "High trending score (rapid growth + very active)"
  },
  {
    name: "moderate-repo",
    stargazers_count: 500,
    created_at: "2026-01-01T00:00:00Z", // 75 days ago
    pushed_at: "2026-03-10T00:00:00Z",  // 7 days ago
    expected: "Moderate trending score"
  }
];

/**
 * Calculate trending score for a repository
 * (Same algorithm as in fetch-trending-repos.mjs)
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
  const recentStarEstimate = starVelocity * pushRecencyScore * tierDays;

  // Normalize components
  const starVelocityNorm = Math.log10(starVelocity + 1);
  const recentStarNorm = Math.log10(recentStarEstimate + 1);

  // Calculate weighted trending score
  const trendingScore =
    (starVelocityNorm * weights.starVelocity) +
    (recentStarNorm * weights.recentStars) +
    (pushRecencyScore * weights.pushRecency * 10);

  return {
    score: trendingScore,
    components: {
      starVelocity: starVelocity.toFixed(2),
      starVelocityNorm: starVelocityNorm.toFixed(3),
      daysSinceCreation: daysSinceCreation.toFixed(1),
      daysSincePush: daysSincePush.toFixed(1),
      pushRecencyScore: pushRecencyScore.toFixed(3),
      recentStarEstimate: recentStarEstimate.toFixed(2),
      recentStarNorm: recentStarNorm.toFixed(3)
    }
  };
}

// Test weights for weekly tier
const weeklyWeights = { starVelocity: 0.6, recentStars: 0.3, pushRecency: 0.1 };
const monthlyWeights = { starVelocity: 0.5, recentStars: 0.3, pushRecency: 0.2 };

console.log("🧪 Testing Trending Score Algorithm\n");
console.log("=" .repeat(80));

// Test with weekly tier weights
console.log("\n📊 WEEKLY TIER (7-day window, weights: 0.6 velocity, 0.3 recent, 0.1 recency)\n");

const weeklyResults = testRepos.map(repo => {
  const result = calculateTrendingScore(repo, weeklyWeights, 7);
  return { repo, ...result };
});

// Sort by score descending
weeklyResults.sort((a, b) => b.score - a.score);

weeklyResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.repo.name}`);
  console.log(`   Stars: ${result.repo.stargazers_count} | Score: ${result.score.toFixed(2)}`);
  console.log(`   Expected: ${result.repo.expected}`);
  console.log(`   Components:`);
  console.log(`     - Star velocity: ${result.components.starVelocity} stars/day (norm: ${result.components.starVelocityNorm})`);
  console.log(`     - Days since creation: ${result.components.daysSinceCreation}`);
  console.log(`     - Days since push: ${result.components.daysSincePush}`);
  console.log(`     - Push recency score: ${result.components.pushRecencyScore}`);
  console.log(`     - Recent star estimate: ${result.components.recentStarEstimate} (norm: ${result.components.recentStarNorm})`);
  console.log();
});

// Test with monthly tier weights
console.log("=" .repeat(80));
console.log("\n📊 MONTHLY TIER (30-day window, weights: 0.5 velocity, 0.3 recent, 0.2 recency)\n");

const monthlyResults = testRepos.map(repo => {
  const result = calculateTrendingScore(repo, monthlyWeights, 30);
  return { repo, score: result.score };
});

monthlyResults.sort((a, b) => b.score - a.score);

monthlyResults.forEach((result, index) => {
  console.log(`${index + 1}. ${result.repo.name}: ${result.score.toFixed(2)}`);
});

console.log("\n" + "=" .repeat(80));
console.log("\n✅ Validation checks:");

// Check that very new hot repo has highest score
const hotRepo = weeklyResults[0];
if (hotRepo.repo.name === "very-new-hot-repo" || hotRepo.repo.name === "rapid-growth-repo") {
  console.log("   ✓ High-velocity, recently active repos score highest");
} else {
  console.log("   ✗ Expected high-velocity repos to score highest");
}

// Check that stagnant repo has low score
const stagnantResult = weeklyResults.find(r => r.repo.name === "stagnant-repo");
if (stagnantResult && stagnantResult.score < 2.0) {
  console.log("   ✓ Inactive repos score lower");
} else {
  console.log("   ✗ Expected inactive repos to score lower");
}

// Check that old stable repo has moderate score
const stableResult = weeklyResults.find(r => r.repo.name === "old-stable-repo");
if (stableResult && stableResult.score > 1.0 && stableResult.score < 5.0) {
  console.log("   ✓ Old but active repos have moderate scores");
} else {
  console.log("   ⚠ Old stable repo score may be outside expected range");
}

console.log("\n✅ Algorithm test complete!\n");
