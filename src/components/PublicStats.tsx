import { Users, Search, Shield } from "lucide-react";
import { fetchPublicStats } from "@/app/actions";

export default async function PublicStats() {
    const stats = await fetchPublicStats();

    const formatStat = (num: number) => {
        if (num < 10) return num.toString();
        const rounded = Math.floor(num / 5) * 5;
        return `${rounded.toLocaleString()}+`;
    };

    return (
        <div className="flex flex-wrap justify-center gap-2 md:gap-4 mt-8 md:mt-12 text-[10px] md:text-sm text-zinc-400">
            <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-900/50 border border-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-full backdrop-blur-sm shadow-xl">
                <Users className="w-3 h-3 md:w-4 md:h-4 text-purple-400" />
                <span className="font-semibold text-zinc-200">
                    {formatStat(stats.totalVisitors)}
                </span>
                <span className="hidden xs:inline">Developers</span>
                <span className="xs:hidden">Devs</span>
            </div>

            <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-900/50 border border-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-full backdrop-blur-sm shadow-xl">
                <Search className="w-3 h-3 md:w-4 md:h-4 text-blue-400" />
                <span className="font-semibold text-zinc-200">
                    {formatStat(stats.totalQueries)}
                </span>
                <span className="hidden xs:inline">Search Queries</span>
                <span className="xs:hidden">Queries</span>
            </div>

            <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-900/50 border border-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-full backdrop-blur-sm shadow-xl">
                <Shield className="w-3 h-3 md:w-4 md:h-4 text-emerald-400" />
                <span className="font-semibold text-zinc-200">
                    {formatStat(stats.totalScans)}
                </span>
                <span className="hidden xs:inline">Security Scans</span>
                <span className="xs:hidden">Scans</span>
            </div>
        </div>
    );
}
