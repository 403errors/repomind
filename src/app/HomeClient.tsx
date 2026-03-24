"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, Star, GitFork, MessageSquare, Globe, TrendingUp } from "lucide-react";
import { getRecentSearches } from "./actions";
import TrustedByMarquee from "@/components/TrustedByMarquee";
import InteractiveDemo from "@/components/InteractiveDemo";
import BentoFeatures from "@/components/BentoFeatures";
import SecurityBanner from "@/components/SecurityBanner";
import { GitHubBadge } from "@/components/GitHubBadge";
import { CAGBadge } from "@/components/CAGBadge";
import CAGComparison from "@/components/CAGComparison";
import { WhatsNewBadge } from "@/components/WhatsNewBadge";
import Image from "next/image";
import { InstallPWA } from "@/components/InstallPWA";
import PublicStats from "@/components/PublicStats";
import AuthButton from "@/components/AuthButton";
import Footer from "@/components/Footer";
import JsonLdScript from "@/components/JsonLdScript";
import type { SearchHistoryItem } from "@/lib/services/history-service";
import { INVALID_SESSION_ERROR_PARAM } from "@/lib/session-guard";
import { BlogPost } from "@prisma/client";
import { CatalogRepoEntry } from "@/lib/repo-catalog";
import { FAQ_PAGE_ITEMS } from "@/lib/faq-data";
import { normalizeGitHubInput } from "@/lib/utils";
import RepoSearch from "@/components/RepoSearch";
import { buildFaqStructuredData, buildSoftwareApplicationStructuredData } from "@/lib/structured-data";

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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [activeFaqIndex, setActiveFaqIndex] = useState<number | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
    const [visibleReposCount, setVisibleReposCount] = useState(6);
    const hasInvalidSessionError = searchParams.get("error") === INVALID_SESSION_ERROR_PARAM;

    const visibleRepos = trendingRepos.slice(0, visibleReposCount);
    const hasMoreRepos = visibleReposCount < trendingRepos.length;
    const softwareSchema = buildSoftwareApplicationStructuredData({
        name: "RepoMind",
        description:
            "RepoMind helps developers analyze GitHub repositories for architecture understanding, AI code review, and security scanning.",
        path: "/",
        featureList: [
            "GitHub repository analysis",
            "Architecture mapping",
            "AI code review workflow",
            "Repository security scanning",
        ],
    });
    const faqSchema = buildFaqStructuredData(FAQ_PAGE_ITEMS);

    useEffect(() => {
        if (session) {
            getRecentSearches().then(setRecentSearches);
        }
    }, [session]);

    const handleSearch = async (query: string) => {
        const normalizedInput = normalizeGitHubInput(query);
        if (!normalizedInput) return;

        setLoading(true);
        setError("");

        try {
            router.push(`/chat?q=${encodeURIComponent(normalizedInput)}`);
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

            <section className="min-h-[100svh] flex flex-col items-center justify-center px-4 py-12 sm:py-14 md:py-16 lg:py-4 relative overflow-hidden z-10">

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="z-10 flex flex-col items-center text-center max-w-3xl w-full px-4 gap-2.5 md:gap-3.5"
                >
                    <div className="w-full flex flex-col items-center gap-3 md:gap-4">
                        <div className="conic-border-container neon-spin-ring rounded-full w-16 h-16 md:w-20 md:h-20 flex items-center justify-center">
                            <Image
                                src="/1080x1080.png"
                                alt="RepoMind Logo"
                                width={96}
                                height={96}
                                className="w-full h-full object-cover rounded-full"
                            />
                        </div>
                        <div className="inline-flex items-center justify-center gap-2 md:gap-3 w-full">
                            <p className="whitespace-nowrap text-[10px] md:text-xs font-semibold tracking-[0.35em] uppercase text-zinc-500 leading-none">
                                RepoMind
                            </p>
                            <WhatsNewBadge />
                        </div>
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70 relative">
                        GitHub Repository Analysis,
                        <br />
                        Code Review & Security Scanning
                    </h1>

                    <CAGBadge />

                    <p className="text-sm sm:text-base md:text-lg text-zinc-300 mb-3 md:mb-4 max-w-2xl mx-auto leading-snug">
                        Understand repositories faster with context-aware AI. Go from URL to architecture, code review, and security triage.
                    </p>

                    {hasInvalidSessionError && (
                        <div className="w-full max-w-md mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
                            Your session could not be validated. Please sign in again.
                        </div>
                    )}

                    <RepoSearch 
                        onSearchSubmit={handleSearch}
                        loading={loading}
                        trendingRepos={trendingRepos}
                        recentSearches={recentSearches}
                        isSessionActive={!!session}
                    />

                    {error && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mt-5 text-red-400 text-sm"
                        >
                            {error}
                        </motion.p>
                    )}

                    <PublicStats stats={publicStats} />
                </motion.div>
            </section>

            <TrustedByMarquee trendingRepos={trendingRepos} />
            <InteractiveDemo />

            <div className="relative z-10 w-full bg-zinc-950">
                <CAGComparison />
            </div>

            <div className="relative z-10 w-full bg-black">
                <BentoFeatures />
                <SecurityBanner />
            </div>

            <section className="relative z-10 w-full bg-black py-24 px-6 border-t border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12">
                        <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">How RepoMind Works</h2>
                        <p className="text-zinc-400 text-lg max-w-3xl mx-auto">
                            Intent-first workflows for repository analysis, architecture clarity, code review, and security prioritization.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="font-semibold mb-2">1. Start with a URL</h3>
                            <p className="text-zinc-400 text-sm">Paste a GitHub repository URL and select your goal.</p>
                        </article>
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="font-semibold mb-2">2. Build context</h3>
                            <p className="text-zinc-400 text-sm">Agentic CAG gathers full-file context needed for reliable understanding.</p>
                        </article>
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="font-semibold mb-2">3. Analyze deeply</h3>
                            <p className="text-zinc-400 text-sm">Map architecture, review implementation, and identify risk hotspots.</p>
                        </article>
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="font-semibold mb-2">4. Take action</h3>
                            <p className="text-zinc-400 text-sm">Get outputs you can use immediately in engineering and security workflows.</p>
                        </article>
                    </div>
                </div>
            </section>

            <section className="relative z-10 w-full bg-zinc-950 py-24 px-6 border-t border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 gap-10 items-start">
                        <div>
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Use Cases That Drive Decisions</h2>
                            <p className="text-zinc-400 text-lg mb-8">
                                RepoMind helps teams reduce uncertainty before adoption, release, and remediation decisions.
                            </p>
                            <div className="space-y-4">
                                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                                    <h3 className="text-xl font-semibold mb-2">Repository Due Diligence</h3>
                                    <p className="text-zinc-400">Evaluate unfamiliar repositories before adopting dependencies or onboarding teams.</p>
                                </article>
                                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                                    <h3 className="text-xl font-semibold mb-2">Context-Aware Code Review</h3>
                                    <p className="text-zinc-400">Review implementation quality with repository context, not isolated snippets.</p>
                                </article>
                                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                                    <h3 className="text-xl font-semibold mb-2">Security Prioritization</h3>
                                    <p className="text-zinc-400">Surface actionable risk signals and triage findings with engineering context.</p>
                                </article>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="relative z-10 w-full bg-black py-24 px-6 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 text-center">Output Examples</h2>
                    <p className="text-zinc-400 text-lg mb-10 text-center max-w-3xl mx-auto">
                        Use RepoMind to generate architecture maps, code-review insights, and security recommendations that teams can act on quickly.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="text-lg font-semibold mb-3">Architecture Snapshot</h3>
                            <p className="text-zinc-400 text-sm mb-4">Clear system-level understanding for onboarding and due diligence.</p>
                            <Link href="/github-repository-analysis" className="text-cyan-300 text-sm hover:text-cyan-200 transition-colors">
                                See repository analysis workflow
                            </Link>
                        </article>
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="text-lg font-semibold mb-3">Code Review Insights</h3>
                            <p className="text-zinc-400 text-sm mb-4">Context-aware findings on logic, dependencies, and potential blind spots.</p>
                            <Link href="/ai-code-review-tool" className="text-cyan-300 text-sm hover:text-cyan-200 transition-colors">
                                Explore AI code review
                            </Link>
                        </article>
                        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                            <h3 className="text-lg font-semibold mb-3">Security Triage Brief</h3>
                            <p className="text-zinc-400 text-sm mb-4">Severity framing and remediation direction for faster action.</p>
                            <Link href="/security-scanner" className="text-cyan-300 text-sm hover:text-cyan-200 transition-colors">
                                Explore security scanner
                            </Link>
                        </article>
                    </div>
                </div>
            </section>

            <section className="relative z-10 w-full bg-black py-24 px-6 border-t border-white/5">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-10">Frequently Asked Questions</h2>
                    <div className="space-y-5">
                        {FAQ_PAGE_ITEMS.map((item, index) => (
                            <article
                                key={item.question}
                                className="rounded-2xl border border-zinc-800 bg-zinc-900/40"
                            >
                                <button
                                    type="button"
                                    aria-expanded={activeFaqIndex === index}
                                    aria-controls={`homepage-faq-answer-${index}`}
                                    onClick={() => setActiveFaqIndex((current) => (current === index ? null : index))}
                                    className="flex w-full items-center justify-between gap-4 p-6 text-left"
                                >
                                    <h3 className="text-xl font-semibold text-white">{item.question}</h3>
                                    <ChevronDown
                                        className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${
                                            activeFaqIndex === index ? "rotate-180 text-white" : ""
                                        }`}
                                    />
                                </button>
                                <motion.div
                                    id={`homepage-faq-answer-${index}`}
                                    aria-hidden={activeFaqIndex !== index}
                                    initial={false}
                                    animate={
                                        activeFaqIndex === index
                                            ? { height: "auto", opacity: 1 }
                                            : { height: 0, opacity: 0 }
                                    }
                                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                    className="overflow-hidden will-change-[height,opacity]"
                                >
                                    <div className="px-6 pb-6">
                                        <p className="text-zinc-400 leading-relaxed">{item.answer}</p>
                                    </div>
                                </motion.div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>


            {trendingRepos.length > 0 && (
                <section id="trending-section" className="relative z-10 w-full bg-black py-24 px-6 border-t border-white/5">
                    <div className="max-w-7xl mx-auto">
                        <div className="mb-12 text-center">
                            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-white">
                                <TrendingUp className="inline-block text-blue-400 mb-1 mr-2 md:mr-3" size={32} />
                                Explore Trending <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Repositories</span>
                            </h2>
                            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
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
                                                    alt={`${repo.owner} avatar`}
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
                                            aria-label={`Analyze ${repo.owner}/${repo.repo} with RepoMind`}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors"
                                        >
                                            <MessageSquare size={12} />
                                            Analyze {repo.repo}
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
                        <div className="flex flex-col items-center text-center mb-12 gap-6">
                            <div>
                                <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                                    Engineering <span className="bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">Insights</span>
                                </h2>
                                <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
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
            <JsonLdScript data={softwareSchema} />
            <JsonLdScript data={faqSchema} />
            <InstallPWA />
        </main>
    );
}
