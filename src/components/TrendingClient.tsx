"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { 
    TrendingUp, 
    Search, 
    Star, 
    GitFork, 
    MessageSquare, 
    Globe, 
    ArrowRight,
    ArrowLeft,
    Filter
} from "lucide-react";
import { CatalogRepoEntry } from "@/lib/repo-catalog";
import Footer from "./Footer";

interface TrendingClientProps {
    initialRepos: CatalogRepoEntry[];
}

export default function TrendingClient({ initialRepos }: TrendingClientProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
    const [visibleCount, setVisibleCount] = useState(50);

    // Get unique languages from the trending set
    const languages = useMemo(() => {
        const langs = new Set<string>();
        initialRepos.forEach(repo => {
            if (repo.language) langs.add(repo.language);
        });
        return Array.from(langs).sort();
    }, [initialRepos]);

    // Filter logic
    const filteredRepos = useMemo(() => {
        return initialRepos.filter(repo => {
            const matchesSearch = 
                repo.repo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                repo.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
                repo.description?.toLowerCase().includes(searchQuery.toLowerCase());
            
            const matchesLanguage = !selectedLanguage || repo.language === selectedLanguage;
            
            return matchesSearch && matchesLanguage;
        });
    }, [initialRepos, searchQuery, selectedLanguage]);

    const visibleRepos = filteredRepos.slice(0, visibleCount);
    const hasMore = visibleCount < filteredRepos.length;

    return (
        <main className="min-h-screen bg-black text-white selection:bg-blue-500/30">
            {/* Header / Nav */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group">
                        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm font-bold">Back to Home</span>
                    </Link>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-white/5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        Weekly Refresh
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-16 px-6 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-64 bg-blue-600/10 rounded-full blur-[120px] -z-10" />
                
                <div className="max-w-7xl mx-auto text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-center"
                    >
                        <div className="mb-6 p-4 rounded-3xl bg-zinc-900 border border-white/5 shadow-2xl">
                            <TrendingUp size={48} className="text-blue-400" />
                        </div>
                        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
                            Explore Trending <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Repositories</span>
                        </h1>
                        <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
                            Discover the most influential and rapidly growing projects on GitHub this week.
                            Analyze any of them instantly with RepoMind&apos;s Agentic intelligence.
                        </p>
                    </motion.div>
                </div>
            </section>

            {/* Filter Bar */}
            <section className="sticky top-16 z-40 bg-black/80 backdrop-blur-md border-b border-white/5 py-3 px-4 md:px-6 mb-12">
                <div className="max-w-7xl mx-auto flex flex-row items-center gap-2 md:gap-4">
                    <div className="relative flex-1 group">
                        <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-zinc-500 w-3.5 h-3.5 group-focus-within:text-blue-400 transition-colors" />
                        <input 
                            type="text"
                            placeholder="Find..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl md:rounded-2xl py-2 md:py-3 pl-10 md:pl-12 pr-4 text-xs md:text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all placeholder:text-zinc-600"
                        />
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2 overflow-x-auto scrollbar-hide shrink-0 max-w-[60%] md:max-w-none">
                        <Filter size={12} className="text-zinc-500 shrink-0 hidden sm:block" />
                        <button
                            onClick={() => setSelectedLanguage(null)}
                            className={`px-3 md:px-4 py-2 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold whitespace-nowrap transition-all border ${
                                !selectedLanguage 
                                ? "bg-blue-500 border-blue-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]" 
                                : "bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/20"
                            }`}
                        >
                            All
                        </button>
                        {languages.slice(0, 8).map(lang => (
                            <button
                                key={lang}
                                onClick={() => setSelectedLanguage(lang)}
                                className={`px-3 md:px-4 py-2 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold whitespace-nowrap transition-all border ${
                                    selectedLanguage === lang
                                    ? "bg-blue-500 border-blue-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]" 
                                    : "bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/20"
                                }`}
                            >
                                {lang}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Repo Grid */}
            <section className="max-w-7xl mx-auto px-6 pb-24">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visibleRepos.map((repo, idx) => (
                        <motion.div 
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx % 12 * 0.05 }}
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
                                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors shadow-xl"
                                >
                                    <MessageSquare size={12} />
                                    Analyze
                                </Link>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {filteredRepos.length === 0 && (
                    <div className="py-24 text-center">
                        <div className="inline-flex p-4 rounded-full bg-zinc-900 border border-white/5 mb-6">
                            <Search size={32} className="text-zinc-500" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">No trending projects found</h3>
                        <p className="text-zinc-500">Try adjusting your search or filters.</p>
                        <button 
                            onClick={() => {setSearchQuery(""); setSelectedLanguage(null);}}
                            className="mt-6 text-blue-400 font-bold hover:underline"
                        >
                            Reset all filters
                        </button>
                    </div>
                )}

                {hasMore && (
                    <div className="mt-16 text-center">
                        <button 
                            onClick={() => setVisibleCount(prev => prev + 50)}
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-zinc-900 border border-white/10 text-white font-bold hover:bg-zinc-800 transition-colors group"
                        >
                            Load 50 more repositories
                            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                )}
            </section>

            <Footer />
        </main>
    );
}
