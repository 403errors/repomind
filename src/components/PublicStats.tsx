"use client";

import { useEffect, useState } from "react";
import { Users, Search } from "lucide-react";
import { fetchPublicStats } from "@/app/actions";

export default function PublicStats() {
    const [stats, setStats] = useState<{ totalVisitors: number; totalQueries: number } | null>(null);

    useEffect(() => {
        let mounted = true;
        fetchPublicStats().then((data) => {
            if (mounted) setStats(data);
        }).catch(console.error);
        return () => { mounted = false; };
    }, []);

    if (!stats || (stats.totalVisitors === 0 && stats.totalQueries === 0)) {
        return (
            <div className="flex flex-wrap justify-center gap-4 mt-8 md:mt-12 text-sm text-zinc-400">
                <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-full backdrop-blur-sm shadow-xl animate-pulse">
                    <div className="w-4 h-4 rounded-full bg-purple-400/20" />
                    <div className="w-8 h-4 bg-zinc-800 rounded" />
                    <div className="w-16 h-4 bg-zinc-800 rounded" />
                </div>
                <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-full backdrop-blur-sm shadow-xl animate-pulse">
                    <div className="w-4 h-4 rounded-full bg-blue-400/20" />
                    <div className="w-8 h-4 bg-zinc-800 rounded" />
                    <div className="w-24 h-4 bg-zinc-800 rounded" />
                </div>
            </div>
        );
    }

    const formatStat = (num: number) => {
        if (num < 25) return num.toString();
        const rounded = Math.floor(num / 25) * 25;
        return `${rounded.toLocaleString()}+`;
    };

    return (
        <div className="flex flex-wrap justify-center gap-4 mt-8 md:mt-12 text-sm text-zinc-400">
            <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-full backdrop-blur-sm shadow-xl">
                <Users className="w-4 h-4 text-purple-400" />
                <span className="font-semibold text-zinc-200">
                    {formatStat(stats.totalVisitors)}
                </span>
                <span>Developers</span>
            </div>

            <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-full backdrop-blur-sm shadow-xl">
                <Search className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-zinc-200">
                    {formatStat(stats.totalQueries)}
                </span>
                <span>Search Queries</span>
            </div>
        </div>
    );
}
