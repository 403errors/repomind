import { Suspense } from "react";
import { Metadata } from "next";
import HomeClient from "./HomeClient";
import { getHomepagePosts } from "@/lib/services/blog-service";
import { getCuratedRepos } from "@/lib/repo-catalog";
import { getPublicStats } from "@/lib/analytics";
import { buildOgImageUrl, createSeoMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
const HOMEPAGE_TRENDING_REPO_LIMIT = 120;

export const metadata: Metadata = createSeoMetadata({
    title: "GitHub Repository Analysis, Code Review & Security Scanning",
    description:
        "Analyze GitHub repositories with full-context AI. Use RepoMind for architecture understanding, AI code review, and repository security scanning.",
    keywords: [
        "github repository analysis",
        "ai code review tool",
        "repository security scanner",
        "github code analyzer",
        "repository risk analysis",
    ],
    canonical: "/",
    ogImage: buildOgImageUrl("marketing", { variant: "home" }),
    ogTitle: "GitHub Repository Analysis, Code Review & Security Scanning | RepoMind",
    ogDescription: "Understand architecture, review code with context, and prioritize repository security risks faster.",
});

export default async function Home() {
    const [latestPosts, trendingRepos, publicStats] = await Promise.all([
        getHomepagePosts(),
        getCuratedRepos("monthly").then((repos) => repos.slice(0, HOMEPAGE_TRENDING_REPO_LIMIT)),
        getPublicStats(),
    ]);

    return (
        <Suspense fallback={null}>
            <HomeClient initialPosts={latestPosts} trendingRepos={trendingRepos} publicStats={publicStats} />
        </Suspense>
    );
}
