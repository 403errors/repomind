"use client";

import { useEffect, useState } from "react";

import { Github, Star } from "lucide-react";
import { fetchRepoDetails } from "@/app/actions";

export function GitHubBadge() {
    const [stars, setStars] = useState<number | null>(null);

    useEffect(() => {
        const getStars = async () => {
            try {
                const data = await fetchRepoDetails("403errors", "repomind");
                // data might be { error: ... } or the repo object
                // fetchRepoDetails returns getRepo result directly which is the repo object
                if (data && typeof (data as any).stargazers_count === 'number') {
                    setStars((data as any).stargazers_count);
                }
            } catch (e) {
                console.error("Failed to fetch repo stars", e);
            }
        };
        getStars();
    }, []);

    return (
        <a
            href="https://github.com/403errors/repomind"
            target="_blank"
            rel="noopener noreferrer"
            className="fixed top-6 right-6 z-[999] hover:scale-105 transition-transform cursor-pointer block"
        >
            <div className="flex items-center gap-2 p-2 md:px-4 md:py-2 bg-gradient-to-r from-zinc-800/80 to-zinc-900/80 border border-zinc-700/50 rounded-full backdrop-blur-md hover:border-zinc-500/50 transition-colors text-white shadow-lg">
                <Github className="w-5 h-5 md:w-4 md:h-4 text-white" />
                <span className="hidden md:inline text-sm font-medium text-zinc-200">Star on GitHub</span>
                {stars !== null && (
                    <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-zinc-700/60 ml-1 text-zinc-400">
                        <span className="text-xs font-mono text-zinc-300">{stars.toLocaleString()}</span>
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                    </div>
                )}
            </div>
        </a>
    );
}
