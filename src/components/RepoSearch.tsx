"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, TrendingUp } from "lucide-react";
import { getRepoSuggestions } from "@/app/actions";
import SuggestionsList from "./SuggestionsList";
import type { RepoSuggestion } from "@/lib/services/repo-suggestions";
import type { CatalogRepoEntry } from "@/lib/repo-catalog";
import type { SearchHistoryItem } from "@/lib/services/history-service";
import Link from "next/link";

interface RepoSearchProps {
    onSearchSubmit: (query: string) => void;
    loading: boolean;
    trendingRepos: CatalogRepoEntry[];
    recentSearches: SearchHistoryItem[];
    isSessionActive: boolean;
}

export default function RepoSearch({
    onSearchSubmit,
    loading,
    trendingRepos,
    recentSearches,
    isSessionActive,
}: RepoSearchProps) {
    const [input, setInput] = useState("");
    const [suggestions, setSuggestions] = useState<RepoSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    useEffect(() => {
        let isCancelled = false;
        
        const fetchSuggestions = async () => {
            if (input.length < 2) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }

            setIsFetchingSuggestions(true);
            try {
                const results = await getRepoSuggestions(input);
                if (!isCancelled) {
                    setSuggestions(results);
                    setShowSuggestions(results.length > 0);
                }
            } catch (err) {
                if (!isCancelled) {
                    console.error("Failed to fetch suggestions:", err);
                }
            } finally {
                if (!isCancelled) {
                    setIsFetchingSuggestions(false);
                }
            }
        };

        const timer = setTimeout(() => {
            if (!loading) {
                fetchSuggestions();
            }
        }, 100);

        return () => {
            isCancelled = true;
            clearTimeout(timer);
        };
    }, [input, loading]);

    const handleInputChange = (val: string) => {
        setInput(val);
        setSelectedIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        } else if (e.key === "Enter" && selectedIndex >= 0) {
            e.preventDefault();
            const selected = suggestions[selectedIndex];
            const suggestionInput = `${selected.owner}/${selected.repo}`;
            setInput(suggestionInput);
            setShowSuggestions(false);
            onSearchSubmit(suggestionInput);
        } else if (e.key === "Escape") {
            setShowSuggestions(false);
        }
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setShowSuggestions(false);
        onSearchSubmit(input);
    };

    const handleSuggestionSelect = (selected: RepoSuggestion) => {
        const suggestionInput = `${selected.owner}/${selected.repo}`;
        setInput(suggestionInput);
        setShowSuggestions(false);
        onSearchSubmit(suggestionInput);
    };

    return (
        <div className="w-full flex flex-col items-center">
            <form onSubmit={handleFormSubmit} className="w-full max-w-md relative group">
                <div className="conic-border-container neon-spin-ring flex items-center bg-zinc-900 p-1 rounded-lg">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => input.length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        placeholder="GitHub URL, username, or repo"
                        className="flex-1 bg-transparent border-none outline-none text-white px-3 py-2 md:px-4 md:py-3 placeholder-zinc-500 text-sm md:text-base w-full min-w-0"
                    />
                    <AnimatePresence>
                        {input.length > 0 && (
                            <motion.button
                                initial={{ opacity: 0, x: 10, scale: 0.9 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                exit={{ opacity: 0, x: 10, scale: 0.9 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                type="submit"
                                disabled={loading}
                                className="p-2 md:p-3 rounded-md transition-all disabled:opacity-60 shrink-0 text-zinc-400 hover:text-white hover:bg-white/5 active:scale-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10"
                            >
                                {loading || isFetchingSuggestions ? (
                                    <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                                ) : (
                                    <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                                )}
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
                <AnimatePresence>
                    {showSuggestions && (
                        <SuggestionsList
                            suggestions={suggestions}
                            onSelect={handleSuggestionSelect}
                            isVisible={showSuggestions}
                            selectedIndex={selectedIndex}
                        />
                    )}
                </AnimatePresence>
            </form>

            <div className="mt-4 md:mt-6 flex flex-col items-center gap-2 md:gap-3 w-full">
                <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 text-[10px] sm:text-xs md:text-sm text-zinc-500">
                    {isSessionActive && recentSearches.length > 0 ? (
                        <>
                            <span>Recent:</span>
                            {recentSearches.slice(0, 3).map((search, i) => (
                                <span key={search.query} className={`${i >= 2 ? 'hidden sm:flex' : 'flex'} items-center gap-2 md:gap-4`}>
                                    <button
                                        onClick={() => {
                                            setInput(search.query);
                                            onSearchSubmit(search.query);
                                        }}
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
                                            onClick={() => {
                                                const query = `${repo.owner}/${repo.repo}`;
                                                setInput(query);
                                                onSearchSubmit(query);
                                            }} 
                                            className="hover:text-white transition-colors truncate max-w-[120px]"
                                        >
                                            {repo.repo}
                                        </button>
                                        {i < 2 && <span className={`${i === 1 ? 'hidden sm:inline' : 'inline'}`}>•</span>}
                                    </span>
                                ))
                            ) : (
                                <>
                                    <button onClick={() => { setInput("torvalds"); onSearchSubmit("torvalds"); }} className="hover:text-white transition-colors">torvalds</button>
                                    <span className="inline">•</span>
                                    <button onClick={() => { setInput("facebook/react"); onSearchSubmit("facebook/react"); }} className="hover:text-white transition-colors">facebook/react</button>
                                    <span className="hidden sm:inline">•</span>
                                    <button onClick={() => { setInput("vercel/next.js"); onSearchSubmit("vercel/next.js"); }} className="hidden md:inline hover:text-white transition-colors">vercel/next.js</button>
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
        </div>
    );
}
