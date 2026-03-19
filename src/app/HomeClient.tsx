"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Star, GitFork, MessageSquare, Globe, TrendingUp } from "lucide-react";
import { fetchGitHubData, getRecentSearches } from "./actions";
import TrustedByMarquee from "@/components/TrustedByMarquee";
import InteractiveDemo from "@/components/InteractiveDemo";
import BentoFeatures from "@/components/BentoFeatures";
import SecurityBanner from "@/components/SecurityBanner";
import WallOfLove from "@/components/WallOfLove";
import { GitHubBadge } from "@/components/GitHubBadge";
import { CAGBadge } from "@/components/CAGBadge";
import CAGComparison from "@/components/CAGComparison";
import { WhatsNewBadge } from "@/components/WhatsNewBadge";
import Image from "next/image";
import { InstallPWA } from "@/components/InstallPWA";
import PublicStats from "@/components/PublicStats";
import AuthButton from "@/components/AuthButton";
import Footer from "@/components/Footer";
import type { SearchHistoryItem } from "@/lib/services/history-service";
import { INVALID_SESSION_ERROR_PARAM } from "@/lib/session-guard";
import { BlogPost } from "@prisma/client";
import { CatalogRepoEntry } from "@/lib/repo-catalog";

type PublicStatsData = {
    totalVisitors: number;
    totalQueries: number;
    totalScans: number;
};

export default function HomeClient({
    initialPosts = [],
    trendingRepos = [],
    publicStats,
}: {
    initialPosts?: BlogPost[];
    trendingRepos?: CatalogRepoEntry[];
    publicStats: PublicStatsData;
}) {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
    const [visibleReposCount, setVisibleReposCount] = useState(6);
    const hasInvalidSessionError = searchParams.get("error") === INVALID_SESSION_ERROR_PARAM;

    const visibleRepos = trendingRepos.slice(0, visibleReposCount);
    const hasMoreRepos = visibleReposCount < trendingRepos.length;

    useEffect(() => {
        if (session) {
            getRecentSearches().then(setRecentSearches);
        }
    }, [session]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        setLoading(true);
        setError("");

        try {
            const result = await fetchGitHubData(input);

            if (result.error) {
                setError(result.error);
            } else {
                router.push(`/chat?q=${encodeURIComponent(input)}`);
            }
        } catch {
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex flex-col bg-black text-white overflow-x-hidden relative">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-purple-600/30 rounded-full blur-[80px] md:blur-[128px]" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-blue-600/30 rounded-full blur-[80px] md:blur-[128px]" />
            </div>

            <div className="fixed top-4 left-4 md:top-6 md:left-6 z-[100]">
                <GitHubBadge />
            </div>

            <div className="fixed top-4 right-4 md:top-6 md:right-6 z-[100]">
                <AuthButton />
            </div>

            <section className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden z-10">

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="z-10 flex flex-col items-center text-center max-w-2xl w-full px-4"
                >
                    <div className="mb-8 conic-border-container rounded-full w-20 h-20 md:w-24 md:h-24 flex items-center justify-center">
                        <Image
                            src="/1080x1080.png"
                            alt="RepoMind Logo"
                            width={96}
                            height={96}
                            className="w-full h-full object-cover rounded-full"
                        />
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-2 md:mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60 relative w-fit mx-auto">
                        RepoMind
                        <div className="hidden md:block absolute -right-20 -top-4">
                            <WhatsNewBadge />
                        </div>
                    </h1>
                    <div className="mb-6 md:hidden">
                        <WhatsNewBadge />
                    </div>

                    <CAGBadge />

                    <p className="text-base sm:text-lg md:text-xl text-zinc-400 mb-8 max-w-lg mx-auto">
                        Understand any codebase in seconds. Deep dive into repositories,
                        explore profiles, run deep security scans and much more.
                    </p>

                    {hasInvalidSessionError && (
                        <div className="w-full max-w-md mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            Your session could not be validated. Please sign in again.
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="w-full max-w-md relative group">
                        <div className="conic-border-container flex items-center bg-zinc-900 p-1 rounded-lg">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="username or username/repo"
                                className="flex-1 bg-transparent border-none outline-none text-white px-3 py-2 md:px-4 md:py-3 placeholder-zinc-500 text-sm md:text-base w-full min-w-0"
                            />
                            <button
                                type="submit"
                                disabled={loading}
                                className="bg-white text-black p-2 md:p-3 rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-50 shrink-0"
                            >
                                {loading ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />}
                            </button>
                        </div>
                    </form>

                    {error && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mt-4 text-red-400 text-sm"
                        >
                            {error}
                        </motion.p>
                    )}

                    <PublicStats stats={publicStats} />

                    <div className="mt-6 md:mt-10 flex flex-col items-center gap-4 md:gap-6 w-full">
                        <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 text-[10px] sm:text-xs md:text-sm text-zinc-500">
                            {session && recentSearches.length > 0 ? (
                                <>
                                    <span>Recent:</span>
                                    {recentSearches.slice(0, 3).map((search, i) => (
                                        <span key={search.query} className={`${i >= 2 ? 'hidden sm:flex' : 'flex'} items-center gap-2 md:gap-4`}>
                                            <button
                                                onClick={() => setInput(search.query)}
                                                className="hover:text-white transition-colors truncate max-w-[120px] md:max-w-none"
                                            >
                                                {search.query}
                                            </button>
                                            {i < Math.min(recentSearches.length, 3) - 1 && <span className={`${i >= 1 ? 'hidden sm:inline' : 'inline'}`}>•</span>}
                                        </span>
                                    ))}
                                </>
                            ) : (
                                <>
                                    <span>Try:</span>
                                    {trendingRepos.length > 0 ? (
                                        trendingRepos.slice(0, 3).map((repo, i) => (
                                            <span key={`${repo.owner}/${repo.repo}`} className={`${i === 2 ? 'hidden sm:flex' : 'flex'} items-center gap-2`}>
                                                <button 
                                                    onClick={() => setInput(`${repo.owner}/${repo.repo}`)} 
                                                    className="hover:text-white transition-colors truncate max-w-[120px]"
                                                >
                                                    {repo.repo}
                                                </button>
                                                {i < 2 && <span className={`${i === 1 ? 'hidden sm:inline' : 'inline'}`}>•</span>}
                                            </span>
                                        ))
                                    ) : (
                                        <>
                                            <button onClick={() => setInput("torvalds")} className="hover:text-white transition-colors">torvalds</button>
                                            <span className="inline">•</span>
                                            <button onClick={() => setInput("facebook/react")} className="hover:text-white transition-colors">facebook/react</button>
                                            <span className="hidden sm:inline">•</span>
                                            <button onClick={() => setInput("vercel/next.js")} className="hidden md:inline hover:text-white transition-colors">vercel/next.js</button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        <Link 
                            href="/trending"
                            className="flex items-center gap-1.5 px-3 py-1 md:py-1.5 rounded-full bg-zinc-900/50 border border-white/5 hover:border-blue-500/30 text-blue-400 hover:text-blue-300 transition-all text-[10px] md:text-xs font-semibold animate-soft-pulse hover:animate-none"
                        >
                            <TrendingUp size={12} className="md:w-3.5 md:h-3.5" /> Explore Trending Repositories
                        </Link>
                    </div>
                </motion.div>
            </section>

            <TrustedByMarquee />
            <InteractiveDemo />

            <div className="relative z-10 w-full bg-zinc-950">
                <CAGComparison />
            </div>

            <div className="relative z-10 w-full bg-black">
                <BentoFeatures />
                <SecurityBanner />
            </div>

            <div className="relative z-10 w-full bg-zinc-950 border-t border-zinc-900">
                <WallOfLove />
            </div>

            {trendingRepos.length > 0 && (
                <section id="trending-section" className="relative z-10 w-full bg-black py-24 px-6 border-t border-white/5">
                    <div className="max-w-7xl mx-auto">
                        <div className="mb-12">
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-white flex items-center gap-3">
                                <TrendingUp className="text-blue-400" size={36} /> Explore Trending <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Repositories</span>
                            </h2>
                            <p className="text-zinc-400 text-lg max-w-2xl">
                                Explore the projects getting the most heat on GitHub this week. Instantly analyze any of them with RepoMind.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {visibleRepos.map((repo) => (
                                <div 
                                    key={`${repo.owner}/${repo.repo}`}
                                    className="bg-zinc-900/40 border border-white/5 rounded-2xl p-6 hover:bg-zinc-900/60 transition-all group flex flex-col justify-between"
                                >
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2 text-zinc-300 font-medium">
                                                <Image 
                                                    src={`https://github.com/${repo.owner}.png`}
                                                    alt={repo.owner}
                                                    width={20}
                                                    height={20}
                                                    className="rounded-full bg-white/10"
                                                />
                                                <span className="truncate max-w-[150px]">{repo.owner}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 text-[10px] font-bold text-zinc-500 uppercase">
                                                <Globe size={10} /> {repo.language || 'Code'}
                                            </div>
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">
                                            {repo.repo}
                                        </h3>
                                        <p className="text-zinc-500 text-sm line-clamp-2 mb-6 min-h-[40px]">
                                            {repo.description || 'Experience high-context AI analysis for this repository.'}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between mt-auto">
                                        <div className="flex items-center gap-4 text-xs text-zinc-500">
                                            <span className="flex items-center gap-1">
                                                <Star size={12} className="text-yellow-500" />
                                                {repo.stars.toLocaleString()}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <GitFork size={12} className="text-zinc-600" />
                                                Trending
                                            </span>
                                        </div>
                                        <Link 
                                            href={`/chat?q=${repo.owner}/${repo.repo}`}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors"
                                        >
                                            <MessageSquare size={12} />
                                            Talk to Repo
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {hasMoreRepos ? (
                            <div className="mt-12 flex flex-col items-center gap-4">
                                <button 
                                    onClick={() => setVisibleReposCount(prev => prev + 6)}
                                    className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white text-black font-bold hover:bg-zinc-200 transition-colors group"
                                >
                                    Show more repositories
                                    <TrendingUp size={18} className="group-hover:scale-110 transition-transform" />
                                </button>
                                <Link 
                                    href="/trending"
                                    className="text-zinc-500 hover:text-white transition-colors text-sm font-medium flex items-center gap-1 group"
                                >
                                    Explore all trending repositories
                                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                </Link>
                            </div>
                        ) : (
                            <div className="mt-12 text-center">
                                <Link 
                                    href="/trending"
                                    className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-zinc-900 border border-white/10 text-white font-bold hover:bg-zinc-800 transition-colors group"
                                >
                                    Explore all trending repositories
                                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                </Link>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {initialPosts.length > 0 && (
                <section className="relative z-10 w-full bg-zinc-950 py-24 px-6 border-t border-white/5">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
                            <div>
                                <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                                    Engineering <span className="bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">Insights</span>
                                </h2>
                                <p className="text-zinc-400 text-lg max-w-2xl">
                                    Latest updates from the lab on AI-driven code intelligence and security.
                                </p>
                            </div>
                            <Link 
                                href="/blog" 
                                className="inline-flex items-center gap-2 text-sm font-bold text-purple-400 hover:text-purple-300 transition-colors group px-4 py-2 rounded-xl bg-purple-500/5 border border-purple-500/10"
                            >
                                View all insights <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>

                        <div className="grid md:grid-cols-3 gap-8">
                            {initialPosts.map((post) => (
                                <Link 
                                    key={post.slug} 
                                    href={`/blog/${post.slug}`}
                                    className="group flex flex-col h-full bg-zinc-900/40 border border-white/5 rounded-3xl p-5 hover:bg-zinc-900/60 hover:border-white/10 transition-all"
                                >
                                    <div className="relative aspect-video rounded-2xl overflow-hidden mb-5 border border-white/5">
                                        <Image 
                                            src={post.image} 
                                            alt={post.title}
                                            fill
                                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-500/20 uppercase">
                                            {post.category}
                                        </span>
                                        <span className="text-zinc-600 text-[10px] uppercase font-bold tracking-tighter">
                                            {post.date}
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-bold mb-3 group-hover:text-purple-400 transition-colors line-clamp-2">
                                        {post.title}
                                    </h3>
                                    <p className="text-zinc-400 text-sm italic opacity-80 line-clamp-2 mb-6">
                                        {post.excerpt}
                                    </p>
                                    <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                                        <span className="text-xs font-bold text-zinc-300">Read insight</span>
                                        <ArrowRight size={14} className="text-zinc-500 group-hover:text-purple-400 group-hover:translate-x-1 transition-all" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            <Footer />

            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "SoftwareApplication",
                        "name": "RepoMind",
                        "applicationCategory": "DeveloperApplication",
                        "operatingSystem": "Web",
                        "offers": {
                            "@type": "Offer",
                            "price": "0",
                            "priceCurrency": "USD",
                        },
                        "description": "RepoMind is a premium AI-powered platform for codebase mastery, enabling developers to analyze, visualize, and chat with any GitHub repository or profile instantly.",
                        "aggregateRating": {
                            "@type": "AggregateRating",
                            "ratingValue": "4.8",
                            "ratingCount": "120",
                        },
                    }),
                }}
            />
            <InstallPWA />
        </main>
    );
}
