import { Suspense } from "react";
import { Metadata } from "next";
import HomeClient from "./HomeClient";
import { getHomepagePosts } from "@/lib/services/blog-service";
import { getCuratedRepos } from "@/lib/repo-catalog";
import { getPublicStats } from "@/lib/analytics";

export const metadata: Metadata = {
    title: "Chat with Any GitHub Repo & Visualize Architecture | RepoMind",
    description:
        "Stop reading code. Use RepoMind's Agentic AI to chat directly with any GitHub repository or developer profile. Instantly generate architecture flowcharts, understand complex codebases, and run security scans without cloning.",
    keywords: [
        "code analyzer",
        "security scanner",
        "repo analyzer",
        "github code analyzer",
        "repository security scanner",
        "ai code review tool",
    ],
    alternates: {
        canonical: "/",
    },
};

export default async function Home() {
    const [latestPosts, trendingRepos, publicStats] = await Promise.all([
        getHomepagePosts(),
        getCuratedRepos("weekly"),
        getPublicStats(),
    ]);

    return (
        <Suspense fallback={null}>
            <HomeClient initialPosts={latestPosts} trendingRepos={trendingRepos} publicStats={publicStats} />
        </Suspense>
    );
}
