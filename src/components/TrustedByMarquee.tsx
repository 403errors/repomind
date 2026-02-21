"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Star } from "lucide-react";

interface RepoData {
    owner: string;
    repo: string;
    stars: number;
}

export default function TrustedByMarquee() {
    const [repos, setRepos] = useState<RepoData[]>([]);

    useEffect(() => {
        // Fetch the top repositories from our generated JSON
        fetch("/data/top-repos.json")
            .then((res) => res.json())
            .then((data: RepoData[]) => {
                // We just need the top 20 or so for the marquee
                setRepos(data.slice(0, 20));
            })
            .catch((err) => console.error("Failed to load top repos", err));
    }, []);

    if (repos.length === 0) {
        return null; // Don't render anything until we have data
    }

    // Duplicate the array to create an infinite loop effect
    const duplicatedRepos = [...repos, ...repos];

    const formatStars = (stars: number) => {
        if (stars >= 1000) {
            return (stars / 1000).toFixed(1) + "k";
        }
        return stars.toString();
    };

    return (
        <section className="py-12 border-y border-zinc-900 bg-zinc-950/50 overflow-hidden relative z-10 w-full mb-12">
            <div className="max-w-7xl mx-auto px-4 mb-6">
                <p className="text-center text-sm font-medium text-zinc-500 uppercase tracking-widest">
                    Analyzed Top Tier Repositories
                </p>
            </div>

            {/* Left and Right Fade Gradients */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 sm:w-1/3 bg-gradient-to-r from-black to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 sm:w-1/3 bg-gradient-to-l from-black to-transparent z-10" />

            <div className="flex w-full items-center">
                <motion.div
                    className="flex whitespace-nowrap gap-8 pr-8"
                    animate={{ x: "-50%" }}
                    transition={{
                        duration: 40,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                >
                    {duplicatedRepos.map((repo, idx) => (
                        <div
                            key={`${repo.owner}-${repo.repo}-${idx}`}
                            className="flex items-center gap-2 text-zinc-400 group hover:text-white transition-colors cursor-default"
                        >
                            <span className="font-semibold text-zinc-300 group-hover:text-blue-400 transition-colors">
                                {repo.owner}
                            </span>
                            <span className="text-zinc-600">/</span>
                            <span className="font-medium text-white">{repo.repo}</span>
                            <div className="flex items-center gap-1 text-xs text-yellow-500/80 bg-zinc-900 px-2 py-0.5 rounded-full ml-2">
                                <Star fill="currentColor" className="w-3 h-3" />
                                <span>{formatStars(repo.stars)}</span>
                            </div>
                        </div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
