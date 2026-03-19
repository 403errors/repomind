"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, User, Github, Database } from "lucide-react";
import type { RepoSuggestion } from "@/lib/services/repo-suggestions";

interface SuggestionsListProps {
    suggestions: RepoSuggestion[];
    onSelect: (suggestion: RepoSuggestion) => void;
    isVisible: boolean;
    selectedIndex: number;
}

export default function SuggestionsList({
    suggestions,
    onSelect,
    isVisible,
    selectedIndex,
}: SuggestionsListProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
            itemRefs.current[selectedIndex]?.scrollIntoView({
                block: "nearest",
                behavior: "auto",
            });
        }
    }, [selectedIndex]);

    if (!isVisible || suggestions.length === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 right-0 top-full mt-2 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-[150]"
        >
            <div 
                ref={listRef}
                className="max-h-[210px] overflow-y-auto custom-scrollbar p-2 space-y-1"
            >
                {suggestions.map((suggestion, index) => (
                    <button
                        key={`${suggestion.owner}/${suggestion.repo}`}
                        ref={(el) => { itemRefs.current[index] = el; }}
                        onClick={() => onSelect(suggestion)}
                        onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
                        className={`w-full text-left px-4 py-3 rounded-lg flex items-start gap-3 transition-all duration-200 ${
                            index === selectedIndex
                                ? "bg-white/10 border-white/10 ring-1 ring-white/20"
                                : "hover:bg-white/5 border-transparent"
                        } border`}
                    >
                        <div className="mt-1 shrink-0 text-zinc-500">
                            {suggestion.source === 'user' ? (
                                <User size={16} />
                            ) : suggestion.source === 'local' ? (
                                <Database size={16} />
                            ) : (
                                <Github size={16} />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-sm font-bold text-white truncate">
                                    {suggestion.owner}/{suggestion.repo}
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                                    <Star size={10} className="text-yellow-500/80" />
                                    {suggestion.stars >= 1000 
                                        ? `${(suggestion.stars / 1000).toFixed(1)}k` 
                                        : suggestion.stars}
                                </span>
                            </div>
                            {suggestion.description && (
                                <p className="text-xs text-zinc-500 truncate italic">
                                    {suggestion.description}
                                </p>
                            )}
                        </div>
                    </button>
                ))}
            </div>
            
            <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-600 font-medium">
                <span>↑↓ to navigate · ↵ to select</span>
                <span className="flex items-center gap-1">
                    {suggestions.some(s => s.source === 'github') ? (
                        <><Github size={10} /> GitHub Search</>
                    ) : suggestions.some(s => s.source === 'user') ? (
                        <><User size={10} /> User Repositories</>
                    ) : (
                        <><Database size={10} /> Catalog Search</>
                    )}
                </span>
            </div>
        </motion.div>
    );
}
