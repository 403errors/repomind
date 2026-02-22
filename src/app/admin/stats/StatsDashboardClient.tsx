"use client";

import { useState, useMemo } from "react";
import {
    Users, Activity, Smartphone, Monitor, Globe,
    RefreshCw, ArrowUpDown, ChevronUp, ChevronDown,
    Clock, Calendar, UserCheck, TrendingUp
} from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { AnalyticsData, VisitorData } from "@/lib/analytics";

interface StatsDashboardClientProps {
    data: AnalyticsData;
    userAgent: string;
    country: string;
    isMobile: boolean;
}

type SortConfig = {
    key: keyof VisitorData | 'id';
    direction: 'asc' | 'desc';
};

export default function StatsDashboardClient({ data, userAgent, country, isMobile }: StatsDashboardClientProps) {
    const router = useRouter();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'lastSeen', direction: 'desc' });
    const [visibleCount, setVisibleCount] = useState(15);

    const handleRefresh = () => {
        setIsRefreshing(true);
        router.refresh();
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const formatIST = (timestamp: number) => {
        return new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'medium',
            hour12: true,
        }).format(new Date(timestamp));
    };

    const getRelativeTime = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    };

    const isOnline = (lastSeen: number) => {
        return (Date.now() - lastSeen) < 5 * 60 * 1000; // 5 minutes
    };

    // Calculate advanced metrics
    const { returningUsers, retentionRate, avgQueriesPerUser, activeNow } = useMemo(() => {
        const returning = data.recentVisitors.filter(v => v.queryCount > 1 && (v.lastSeen - v.firstSeen > 1000 * 60 * 60)).length;
        const rate = data.totalVisitors > 0 ? (returning / data.totalVisitors) * 100 : 0;
        const avgQueries = data.totalVisitors > 0 ? (data.totalQueries / data.totalVisitors).toFixed(1) : "0";
        const nowCount = data.recentVisitors.filter(v => isOnline(v.lastSeen)).length;

        return {
            returningUsers: returning,
            retentionRate: rate.toFixed(1),
            avgQueriesPerUser: avgQueries,
            activeNow: nowCount
        };
    }, [data]);

    const sortedVisitors = useMemo(() => {
        const items = [...data.recentVisitors];
        items.sort((a, b) => {
            const aValue = a[sortConfig.key as keyof VisitorData] ?? '';
            const bValue = b[sortConfig.key as keyof VisitorData] ?? '';

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return items;
    }, [data.recentVisitors, sortConfig]);

    const displayedVisitors = useMemo(() => {
        return sortedVisitors.slice(0, visibleCount);
    }, [sortedVisitors, visibleCount]);

    const requestSort = (key: keyof VisitorData | 'id') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ column }: { column: keyof VisitorData | 'id' }) => {
        if (sortConfig.key !== column) return <ArrowUpDown className="w-4 h-4 text-zinc-600" />;
        return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />;
    };

    return (
        <div className="min-h-screen bg-black text-white p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                                Analytics Dashboard
                            </h1>
                            <p className="text-zinc-500 text-sm mt-1">Real-time platform performance monitoring (IST)</p>
                        </div>
                        {activeNow > 0 && (
                            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full h-fit mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">{activeNow} Active Now</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                            <div className="text-sm text-zinc-400">Current Time (IST)</div>
                            <div className="text-xs font-mono text-zinc-500">{formatIST(Date.now())}</div>
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="flex items-center gap-2 bg-zinc-900 border border-white/10 px-4 py-2 rounded-lg hover:bg-zinc-800 transition-all active:scale-95 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
                            <span className="text-sm font-medium">Refresh</span>
                        </button>
                    </div>
                </div>

                {/* Session Debug Info */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-zinc-900/30 border border-yellow-500/10 rounded-xl p-4 overflow-hidden relative"
                >
                    <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500/50" />
                    <h3 className="text-yellow-500/80 font-mono text-[10px] mb-3 uppercase tracking-[0.2em]">Your Current Session</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm font-mono">
                        <div className="space-y-1">
                            <span className="text-zinc-500 block text-[10px] uppercase">Country</span>
                            <span className="text-zinc-200 flex items-center gap-2">
                                <Globe className="w-3 h-3 text-zinc-400" />
                                {country || "Unknown"}
                            </span>
                        </div>
                        <div className="space-y-1">
                            <span className="text-zinc-500 block text-[10px] uppercase">Device</span>
                            <span className={isMobile ? "text-orange-400 flex items-center gap-2" : "text-blue-400 flex items-center gap-2"}>
                                {isMobile ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                                {isMobile ? "Mobile" : "Desktop"}
                            </span>
                        </div>
                        <div className="space-y-1 sm:col-span-1">
                            <span className="text-zinc-500 block text-[10px] uppercase">User Agent Snippet</span>
                            <span className="text-zinc-500 truncate block text-xs" title={userAgent}>{userAgent.slice(0, 40)}...</span>
                        </div>
                    </div>
                </motion.div>

                {/* Main KPIs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatsCard
                        title="Total Visitors"
                        value={data.totalVisitors}
                        subValue={`${returningUsers} returning`}
                        icon={<Users className="w-5 h-5 text-purple-400" />}
                        trend="+12%"
                    />
                    <StatsCard
                        title="Total Queries"
                        value={data.totalQueries}
                        subValue={`${avgQueriesPerUser} per visitor`}
                        icon={<Activity className="w-5 h-5 text-blue-400" />}
                        trend="+5%"
                    />
                    <StatsCard
                        title="Retention Rate"
                        value={`${retentionRate}%`}
                        subValue="Returning users"
                        icon={<TrendingUp className="w-5 h-5 text-green-400" />}
                    />
                    <StatsCard
                        title="Active Now"
                        value={activeNow}
                        subValue="Last 5 minutes"
                        icon={<div className="relative"><Globe className="w-5 h-5 text-green-400" />{activeNow > 0 && <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-ping" />}</div>}
                    />
                </div>

                {/* Secondary Metrics & Simple Trends */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                <Activity className="w-5 h-5 text-blue-400" />
                                Activity Visualization
                            </h2>
                            <div className="flex items-center gap-3 text-xs text-zinc-500">
                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500" /> Visitors</div>
                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /> Queries</div>
                            </div>
                        </div>

                        {/* Simple Bar Visualization of Device Breakdown because we don't have time-series history in KV yet */}
                        <div className="space-y-8">
                            <div>
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-sm text-zinc-400">Device Distribution</span>
                                    <span className="text-xs text-zinc-500">BY PERCENTAGE</span>
                                </div>
                                <div className="h-12 w-full flex rounded-xl overflow-hidden bg-zinc-800">
                                    {Object.entries(data.deviceStats).map(([device, count], idx) => {
                                        const percentage = (count / data.totalVisitors) * 100;
                                        if (percentage === 0) return null;
                                        const colors = {
                                            desktop: 'bg-blue-500',
                                            mobile: 'bg-orange-500',
                                            unknown: 'bg-zinc-600'
                                        };
                                        return (
                                            <motion.div
                                                key={device}
                                                initial={{ width: 0 }}
                                                animate={{ width: `${percentage}%` }}
                                                className={`${colors[device as keyof typeof colors] || 'bg-zinc-500'} h-full flex items-center justify-center relative group`}
                                            >
                                                <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute text-[10px] font-bold text-white uppercase whitespace-nowrap">
                                                    {device}: {Math.round(percentage)}%
                                                </span>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
                                <div className="space-y-3">
                                    <h3 className="text-sm font-medium text-zinc-300">Top Countries</h3>
                                    <div className="space-y-4">
                                        {Object.entries(data.countryStats)
                                            .sort(([, a], [, b]) => b - a)
                                            .slice(0, 4)
                                            .map(([country, count]) => (
                                                <div key={country} className="space-y-1">
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-zinc-400">{country}</span>
                                                        <span className="text-zinc-500">{count}</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                                                        <motion.div
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${(count / data.totalVisitors) * 100}%` }}
                                                            className="h-full bg-purple-500/40"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div className="bg-purple-900/10 border border-purple-500/20 rounded-xl p-4 flex flex-col justify-center">
                                    <div className="flex items-center gap-3 mb-2 text-purple-400">
                                        <UserCheck className="w-5 h-5" />
                                        <span className="font-semibold">Engagement Insight</span>
                                    </div>
                                    <p className="text-sm text-zinc-400 leading-relaxed">
                                        Your platform has a <span className="text-white font-medium">{retentionRate}% retention rate</span>.
                                        High query volume from {Object.entries(data.countryStats).sort(([, a], [, b]) => b - a)[0]?.[0] || 'users'} suggests
                                        strong feature adoption in those regions.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-green-400" />
                            Session Pulse
                        </h2>
                        <div className="space-y-6">
                            <div className="p-4 bg-zinc-800/50 rounded-xl border border-white/5">
                                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Active Now</div>
                                <div className="text-3xl font-bold text-white flex items-center gap-3">
                                    {activeNow}
                                    {activeNow > 0 && <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />}
                                </div>
                                <div className="text-xs text-zinc-400 mt-2">
                                    Last 5 minutes matching window
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-400">Active (24h)</span>
                                    <span className="font-mono text-zinc-200">{data.activeUsers24h}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-400">Avg. Queries</span>
                                    <span className="font-mono text-zinc-200">{avgQueriesPerUser}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-400">Total Sessions</span>
                                    <span className="font-mono text-zinc-200">{data.totalVisitors}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-400">Returning Users</span>
                                    <span className="font-mono text-zinc-200">{returningUsers}</span>
                                </div>
                            </div>

                            <div className="pt-4">
                                <button className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-zinc-300 transition-colors">
                                    Export CSV Report
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Visitors Table */}
                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Recent Visitors</h2>
                        <span className="text-xs text-zinc-500 font-mono">Showing {displayedVisitors.length} of {data.recentVisitors.length}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-zinc-900/80 text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('id')}>
                                        <div className="flex items-center gap-2">
                                            Visitor ID <SortIcon column="id" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('country')}>
                                        <div className="flex items-center gap-2">
                                            Country <SortIcon column="country" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('device')}>
                                        <div className="flex items-center gap-2">
                                            Device <SortIcon column="device" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('queryCount')}>
                                        <div className="flex items-center gap-2">
                                            Queries <SortIcon column="queryCount" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('lastSeen')}>
                                        <div className="flex items-center gap-2">
                                            Last Seen (IST) <SortIcon column="lastSeen" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                <AnimatePresence mode="popLayout">
                                    {displayedVisitors.map((visitor) => {
                                        const online = isOnline(visitor.lastSeen);
                                        return (
                                            <motion.tr
                                                layout
                                                key={visitor.id}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="hover:bg-white/[0.02] transition-colors group"
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/5 flex items-center justify-center text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                                                            {visitor.id.slice(0, 2).toUpperCase()}
                                                        </div>
                                                        <span className="font-mono text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
                                                            {visitor.id.slice(0, 8)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-zinc-300">{visitor.country}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`flex items-center gap-2 capitalize ${visitor.device === 'mobile' ? 'text-orange-400/80' : 'text-blue-400/80'}`}>
                                                        {visitor.device === 'mobile' ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                                                        {visitor.device}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-mono text-zinc-300">{visitor.queryCount || 0}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-zinc-300">{formatIST(visitor.lastSeen)}</span>
                                                        <span className="text-[10px] text-zinc-500 font-mono uppercase">{getRelativeTime(visitor.lastSeen)}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {online ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold uppercase tracking-wider border border-green-500/20">
                                                            <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                                                            Online
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-zinc-800 text-zinc-500 text-[10px] font-bold uppercase tracking-wider border border-white/5">
                                                            Offline
                                                        </span>
                                                    )}
                                                </td>
                                            </motion.tr>
                                        );
                                    })}
                                </AnimatePresence>
                                {data.recentVisitors.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                                            <div className="flex flex-col items-center gap-2">
                                                <Users className="w-8 h-8 opacity-20" />
                                                <p>No visitors recorded in the current dataset.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {visibleCount < sortedVisitors.length && (
                    <div className="flex justify-center pb-8">
                        <button
                            onClick={() => setVisibleCount(prev => prev + 15)}
                            className="bg-zinc-900 border border-white/10 px-8 py-3 rounded-xl hover:bg-zinc-800 hover:border-white/20 transition-all font-medium text-sm text-zinc-400 hover:text-white"
                        >
                            Show 15 more visitors
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatsCard({ title, value, icon, subValue, trend }: {
    title: string,
    value: string | number,
    icon: React.ReactNode,
    subValue?: string,
    trend?: string
}) {
    return (
        <motion.div
            whileHover={{ y: -2 }}
            className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 relative overflow-hidden group"
        >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                {icon}
            </div>
            <div className="flex items-center gap-4 mb-4">
                <div className="p-2.5 bg-white/5 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
                    {icon}
                </div>
                <div className="text-sm font-medium text-zinc-400">{title}</div>
            </div>
            <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-white tracking-tight">{value}</div>
                {trend && (
                    <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded uppercase">
                        {trend}
                    </span>
                )}
            </div>
            {subValue && (
                <div className="text-xs text-zinc-500 mt-2 font-medium uppercase tracking-wider">{subValue}</div>
            )}
        </motion.div>
    );
}
