"use client";

import { useEffect, useState, useMemo } from "react";
import {
    Users, Activity, Smartphone, Monitor, Globe,
    RefreshCw, ArrowUpDown, ChevronUp, ChevronDown,
    UserCheck, TrendingUp, Database, Zap, Mail, Search, MessageSquare, ShieldAlert, Trash2
} from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { AnalyticsData, LoggedInUserData, VisitorData } from "@/lib/analytics";
import {
    deleteLoggedInUserAccount,
    resetAdminReportFunnel,
    updateReportFalsePositiveReviewStatus,
} from "@/app/actions";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type HistoryRange = "24h" | "1w" | "1m" | "3m";
type SelectionRange = "24h" | "7d";

interface StatsDashboardClientProps {
    data: AnalyticsData;
    userAgent: string;
    country: string;
    isMobile: boolean;
    currentUsername: string | null;
}

type SortConfig = {
    key: keyof VisitorData | 'id';
    direction: 'asc' | 'desc';
};

function formatFalsePositiveReason(reason: string): string {
    return reason
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export default function StatsDashboardClient({
    data,
    userAgent,
    country,
    isMobile,
    currentUsername,
}: StatsDashboardClientProps) {
    const router = useRouter();
    const [falsePositiveRows, setFalsePositiveRows] = useState(() => data.falsePositiveReview?.recentSubmissions ?? []);
    const [accountRows, setAccountRows] = useState<LoggedInUserData[]>(() => data.loggedInUsers ?? []);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedRange, setSelectedRange] = useState<HistoryRange>("24h");
    const [selectionRange, setSelectionRange] = useState<SelectionRange>("24h");
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'lastSeen', direction: 'desc' });
    const [visibleCount, setVisibleCount] = useState(15);
    const [currentTime, setCurrentTime] = useState(0);
    const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(null);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const [isResettingFunnel, setIsResettingFunnel] = useState(false);
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<LoggedInUserData | null>(null);

    useEffect(() => {
        const tick = () => setCurrentTime(Date.now());
        tick();

        const intervalId = setInterval(tick, 30_000);
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        setFalsePositiveRows(data.falsePositiveReview?.recentSubmissions ?? []);
    }, [data.falsePositiveReview]);

    useEffect(() => {
        setAccountRows(data.loggedInUsers ?? []);
    }, [data.loggedInUsers]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        router.refresh();
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const handleFalsePositiveStatusChange = async (
        submissionId: string,
        status: "PENDING" | "CONFIRMED_FALSE_POSITIVE" | "REJECTED"
    ) => {
        setPendingSubmissionId(submissionId);
        try {
            const updated = await updateReportFalsePositiveReviewStatus({ submissionId, status });
            setFalsePositiveRows((current) => current.map((row) => row.id === submissionId ? updated : row));
            toast.success("False positive status updated");
            router.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update false positive status";
            toast.error(message);
        } finally {
            setPendingSubmissionId(null);
        }
    };

    const handleResetReportFunnel = async () => {
        setIsResettingFunnel(true);
        try {
            await resetAdminReportFunnel();
            toast.success("Report funnel counters reset");
            setIsResetDialogOpen(false);
            router.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to reset report funnel";
            toast.error(message);
        } finally {
            setIsResettingFunnel(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!deleteCandidate) return;

        setDeletingUserId(deleteCandidate.id);
        try {
            await deleteLoggedInUserAccount({ userId: deleteCandidate.id });
            setAccountRows((current) => current.filter((user) => user.id !== deleteCandidate.id));
            toast.success("Incomplete account deleted");
            setDeleteCandidate(null);
            router.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete account";
            toast.error(message);
        } finally {
            setDeletingUserId(null);
        }
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
        const diff = currentTime - timestamp;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    };

    const isOnline = (lastSeen: number) => {
        return (currentTime - lastSeen) < 5 * 60 * 1000; // 5 minutes
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Calculate advanced metrics
    const returningUsers = data.recentVisitors.filter(
        (v) => v.queryCount > 1 && (v.lastSeen - v.firstSeen > 1000 * 60 * 60)
    ).length;
    const retentionRate = data.totalVisitors > 0
        ? ((returningUsers / data.totalVisitors) * 100).toFixed(1)
        : "0";
    const avgQueriesPerUser = data.totalVisitors > 0
        ? (data.totalQueries / data.totalVisitors).toFixed(1)
        : "0";
    const activeNow = data.recentVisitors.filter((v) => isOnline(v.lastSeen)).length;
    const reportFunnel = data.reportFunnel;
    const weeklyReportViews = reportFunnel?.weekly.report_viewed_shared ?? 0;
    const weeklyFixStarts = reportFunnel?.weekly.report_fix_chat_started ?? 0;
    const weeklyLoginGates = reportFunnel?.weekly.report_fix_login_gate_shown ?? 0;
    const weeklyConversionRate = reportFunnel?.weeklyConversionRate ?? 0;
    const falsePositiveReview = data.falsePositiveReview;
    const loggedInUsers = accountRows;
    const selectionStats = data.searchPerformance?.byWindow?.[selectionRange] ?? {
        avgSelectionMs: 0,
        indexHitRate: 0,
        fallbackRate: 0,
        selections: 0,
    };
    const incompleteLoggedInUsers = useMemo(
        () => accountRows.filter((user) => !user.email),
        [accountRows]
    );

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
    const displayedLoggedInUsers = useMemo(() => {
        return loggedInUsers.slice(0, 100);
    }, [loggedInUsers]);

    const requestSort = (key: keyof VisitorData | 'id') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const renderSortIcon = (column: keyof VisitorData | 'id') => {
        if (sortConfig.key !== column) return <ArrowUpDown className="w-4 h-4 text-zinc-600" />;
        return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />;
    };

    return (
        <div className="space-y-8">
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
                            <div className="text-xs font-mono text-zinc-500">
                                {currentTime > 0 ? formatIST(currentTime) : "Syncing..."}
                            </div>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
                    <StatsCard
                        title="Logged Accounts"
                        value={loggedInUsers.length}
                        subValue={`${loggedInUsers.length} shown`}
                        icon={<UserCheck className="w-5 h-5 text-cyan-400" />}
                    />
                    <StatsCard
                        title="KV Storage"
                        value={formatSize(data.kvStats?.currentSize || 0)}
                        subValue={`${((data.kvStats?.currentSize || 0) / (data.kvStats?.maxSize || 1) * 100).toFixed(2)}% of ${formatSize(data.kvStats?.maxSize || 0)}`}
                        icon={<Database className="w-5 h-5 text-amber-400" />}
                    />
                </div>

                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                        <div>
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Search className="w-5 h-5 text-cyan-400" />
                                Search Performance
                            </h2>
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">File selection speed + fallback rate</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            {(["24h", "7d"] as const).map((range) => (
                                <button
                                    key={range}
                                    type="button"
                                    onClick={() => setSelectionRange(range)}
                                    className={`rounded-lg border px-3 py-1 font-semibold uppercase tracking-wider transition-colors ${selectionRange === range ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
                                >
                                    {range}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricTile label="Avg Selection" value={`${selectionStats.avgSelectionMs} ms`} />
                        <MetricTile label="Index Hit Rate" value={`${selectionStats.indexHitRate.toFixed(1)}%`} />
                        <MetricTile label="Fallback Rate" value={`${selectionStats.fallbackRate.toFixed(1)}%`} />
                        <MetricTile label="Selections" value={selectionStats.selections} />
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                        <div>
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Zap className="w-5 h-5 text-indigo-400" />
                                Report to Chat Funnel (7d)
                            </h2>
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">{"North star: report -> chat starts"}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsResetDialogOpen(true)}
                            disabled={isResettingFunnel}
                            className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isResettingFunnel ? "animate-spin" : ""}`} />
                            Reset Funnel
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricTile label="Shared Views" value={weeklyReportViews} />
                        <MetricTile label="Login Gates" value={weeklyLoginGates} />
                        <MetricTile label="Fix Chats" value={weeklyFixStarts} />
                        <MetricTile label="Conv Rate" value={`${weeklyConversionRate.toFixed(1)}%`} />
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5 text-amber-400" />
                            False Positive Review
                        </h2>
                        <span className="text-xs text-zinc-500 uppercase tracking-wider">Recent submissions + review state</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricTile label="Total" value={falsePositiveReview?.total ?? 0} />
                        <MetricTile label="Pending" value={falsePositiveReview?.pending ?? 0} />
                        <MetricTile label="Confirmed" value={falsePositiveReview?.confirmedFalsePositive ?? 0} />
                        <MetricTile label="Rejected" value={falsePositiveReview?.rejected ?? 0} />
                    </div>
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
                                    {Object.entries(data.deviceStats).map(([device, count]) => {
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

                {/* storage usage chart */}
                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                <Database className="w-5 h-5 text-amber-400" />
                                KV Cache Storage History
                            </h2>
                            <p className="text-zinc-500 text-xs mt-1">Storage usage trend over the selected period (MB)</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <select
                                value={selectedRange}
                                onChange={(e) => setSelectedRange(e.target.value as HistoryRange)}
                                className="bg-white/5 border border-white/10 rounded-lg text-xs py-1 px-3 text-zinc-300 focus:outline-none focus:border-amber-500/50"
                            >
                                <option value="24h">Last 24 Hours</option>
                                <option value="1w">Last Week</option>
                                <option value="1m">Last Month</option>
                                <option value="3m">Last 3 Months</option>
                            </select>
                            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                                <Zap className="w-3 h-3 text-amber-500" />
                                <span>LIMIT: {formatSize(data.kvStats?.maxSize || 0)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="h-64 w-full relative group">
                        {(() => {
                            const history = data.kvStats?.history || [];
                            if (history.length < 2) return (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                    <Database className="w-10 h-10 opacity-10 mb-2" />
                                    <p className="text-sm">Collecting storage history data...</p>
                                </div>
                            );

                            const now = currentTime > 0
                                ? currentTime
                                : (history[history.length - 1]?.timestamp ?? 0);
                            const ranges = {
                                "24h": now - 24 * 60 * 60 * 1000,
                                "1w": now - 7 * 24 * 60 * 60 * 1000,
                                "1m": now - 30 * 24 * 60 * 60 * 1000,
                                "3m": now - 90 * 24 * 60 * 60 * 1000
                            };

                            let filteredHistory = history.filter(h => h.timestamp >= ranges[selectedRange]);

                            // If too many points, aggregate to keep SVG manageable
                            const maxPoints = 60;
                            if (filteredHistory.length > maxPoints) {
                                const step = Math.ceil(filteredHistory.length / maxPoints);
                                filteredHistory = filteredHistory.filter((_, i) => i % step === 0);
                            }

                            if (filteredHistory.length < 2) return (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                    <Database className="w-10 h-10 opacity-10 mb-2" />
                                    <p className="text-sm">No data points for this range yet...</p>
                                </div>
                            );

                            return (
                                <div className="w-full h-full pt-4">
                                    <svg className="w-full h-full overflow-hidden" preserveAspectRatio="none" viewBox={`0 0 ${filteredHistory.length - 1} 100`}>
                                        <defs>
                                            <linearGradient id="line-gradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                                                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                                            </linearGradient>
                                        </defs>

                                        {/* Grid Lines */}
                                        {[0, 25, 50, 75, 100].map((y) => (
                                            <line
                                                key={y}
                                                x1="0"
                                                y1={y}
                                                x2={filteredHistory.length - 1}
                                                y2={y}
                                                stroke="rgba(255,255,255,0.05)"
                                                strokeWidth="1"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                        ))}

                                        {(() => {
                                            const points = filteredHistory;
                                            const minSize = Math.min(...points.map(p => p.size));
                                            const maxSize = Math.max(...points.map(p => p.size));
                                            const range = Math.max(maxSize - minSize, 1024);
                                            const padding = range * 0.1;

                                            const getRelativeY = (size: number) => {
                                                const rawY = 100 - ((size - (minSize - padding)) / (range + 2 * padding) * 100);
                                                return Math.max(0, Math.min(100, rawY)); // Clamp to 0-100
                                            };

                                            const normalizedPoints = points.map((p, i) => `${i},${getRelativeY(p.size)}`).join(' ');
                                            const areaPoints = `0,100 ${normalizedPoints} ${points.length - 1},100`;

                                            return (
                                                <>
                                                    <polyline
                                                        points={areaPoints}
                                                        fill="url(#line-gradient)"
                                                        className="transition-all duration-700"
                                                    />
                                                    <polyline
                                                        points={normalizedPoints}
                                                        fill="none"
                                                        stroke="#f59e0b"
                                                        strokeWidth="2"
                                                        strokeLinejoin="round"
                                                        strokeLinecap="round"
                                                        vectorEffect="non-scaling-stroke"
                                                        className="transition-all duration-700"
                                                    />

                                                    {points.map((p, i) => {
                                                        const y = getRelativeY(p.size);
                                                        return (
                                                            <g key={i} className="cursor-pointer group/point">
                                                                <rect
                                                                    x={i - 0.5}
                                                                    y={0}
                                                                    width={1}
                                                                    height={100}
                                                                    fill="transparent"
                                                                />
                                                                <circle
                                                                    cx={i}
                                                                    cy={y}
                                                                    r="3"
                                                                    fill="#f59e0b"
                                                                    className="opacity-0 group-hover/point:opacity-100 transition-opacity"
                                                                    vectorEffect="non-scaling-size"
                                                                />
                                                                <title>{`${new Date(p.timestamp).toLocaleString()} - ${formatSize(p.size)}`}</title>
                                                            </g>
                                                        );
                                                    })}
                                                </>
                                            );
                                        })()}
                                    </svg>

                                    {/* X-Axis Labels */}
                                    <div className="absolute bottom-0 left-0 w-full flex justify-between px-1 text-[8px] font-mono text-zinc-600 mt-2">
                                        <span>{new Date(filteredHistory[0].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        <span>{new Date(filteredHistory[filteredHistory.length - 1].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* Logged-In Accounts Table */}
                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
                        <h2 className="text-xl font-semibold">False Positive Queue</h2>
                        <span className="text-xs text-zinc-500 font-mono">
                            Showing {falsePositiveRows.length} recent submissions
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-900/80 text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-6 py-4">Repository</th>
                                    <th className="px-6 py-4">Finding</th>
                                    <th className="px-6 py-4">Reporter Notes</th>
                                    <th className="px-6 py-4">Submitted By</th>
                                    <th className="px-6 py-4">Created</th>
                                    <th className="px-6 py-4">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {falsePositiveRows.map((submission) => (
                                    <tr key={submission.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-zinc-200 font-medium">{submission.owner}/{submission.repo}</span>
                                                <span className="text-[10px] text-zinc-500 font-mono uppercase">
                                                    {submission.isSharedView ? "Shared report" : "Private report"}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-zinc-200">{submission.title}</span>
                                                <span className="text-xs text-zinc-500">
                                                    {submission.severity.toUpperCase()} • {submission.file}{submission.line ? `:${submission.line}` : ""}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="max-w-md space-y-2">
                                                <span className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                                                    {formatFalsePositiveReason(submission.reason)}
                                                </span>
                                                <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                                                    {submission.details}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-zinc-300">
                                            {submission.submittedByGithubLogin ? `@${submission.submittedByGithubLogin}` : "Anonymous"}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-zinc-300">{formatIST(submission.createdAt)}</span>
                                                <span className="text-[10px] text-zinc-500 font-mono uppercase">{getRelativeTime(submission.createdAt)}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <select
                                                value={submission.status}
                                                onChange={(e) => void handleFalsePositiveStatusChange(
                                                    submission.id,
                                                    e.target.value as "PENDING" | "CONFIRMED_FALSE_POSITIVE" | "REJECTED"
                                                )}
                                                disabled={pendingSubmissionId === submission.id}
                                                className="min-w-[210px] rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
                                            >
                                                <option value="PENDING">Pending</option>
                                                <option value="CONFIRMED_FALSE_POSITIVE">Confirmed False Positive</option>
                                                <option value="REJECTED">Rejected</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                                {falsePositiveRows.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                                            <div className="flex flex-col items-center gap-2">
                                                <ShieldAlert className="w-8 h-8 opacity-20" />
                                                <p>No false positive submissions yet.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
                        <div className="flex flex-col gap-2">
                            <h2 className="text-xl font-semibold">Logged-In Accounts (Postgres)</h2>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="rounded-full border border-white/10 bg-zinc-950 px-2.5 py-1 font-mono text-zinc-500">
                                    Showing {displayedLoggedInUsers.length} of {loggedInUsers.length}
                                </span>
                                <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 font-semibold uppercase tracking-wider text-red-200">
                                    {incompleteLoggedInUsers.length} incomplete without email
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-zinc-900/80 text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-6 py-4">Account</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4 text-right">Queries</th>
                                    <th className="px-6 py-4 text-right">Scans</th>
                                    <th className="px-6 py-4 text-right">Searches</th>
                                    <th className="px-6 py-4 text-right">Chats</th>
                                    <th className="px-6 py-4">Last Activity (IST)</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {displayedLoggedInUsers.map((user) => (
                                    <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-zinc-200 font-medium">
                                                        {user.githubLogin ? `@${user.githubLogin}` : user.id.slice(0, 10)}
                                                    </span>
                                                    {!user.email && (
                                                        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-200">
                                                            Incomplete
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-zinc-500 font-mono uppercase">
                                                    Joined {formatIST(user.createdAt)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-zinc-300">
                                            <span className={`inline-flex items-center gap-2 ${user.email ? "" : "text-red-200"}`}>
                                                <Mail className="w-3 h-3 text-zinc-500" />
                                                {user.email || "Missing email"}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-zinc-200">{user.queryCount}</td>
                                        <td className="px-6 py-4 text-right font-mono text-zinc-200">{user.scanCount}</td>
                                        <td className="px-6 py-4 text-right font-mono text-zinc-200">
                                            <span className="inline-flex items-center gap-1">
                                                <Search className="w-3 h-3 text-zinc-500" />
                                                {user.searchCount}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-zinc-200">
                                            <span className="inline-flex items-center gap-1">
                                                <MessageSquare className="w-3 h-3 text-zinc-500" />
                                                {user.chatCount}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {user.lastActivityAt ? (
                                                <div className="flex flex-col">
                                                    <span className="text-zinc-300">{formatIST(user.lastActivityAt)}</span>
                                                    <span className="text-[10px] text-zinc-500 font-mono uppercase">{getRelativeTime(user.lastActivityAt)}</span>
                                                </div>
                                            ) : (
                                                <span className="text-zinc-500">No activity</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {!user.email && user.githubLogin !== currentUsername ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteCandidate(user)}
                                                    disabled={deletingUserId === user.id}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    {deletingUserId === user.id ? "Deleting..." : "Delete"}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-zinc-600">
                                                    {user.githubLogin === currentUsername ? "Protected" : "Retained"}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {loggedInUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-zinc-500">
                                            <div className="flex flex-col items-center gap-2">
                                                <UserCheck className="w-8 h-8 opacity-20" />
                                                <p>No logged-in account activity yet.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
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
                                            Visitor ID {renderSortIcon("id")}
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('country')}>
                                        <div className="flex items-center gap-2">
                                            Country {renderSortIcon("country")}
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('device')}>
                                        <div className="flex items-center gap-2">
                                            Device {renderSortIcon("device")}
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('queryCount')}>
                                        <div className="flex items-center gap-2">
                                            Queries {renderSortIcon("queryCount")}
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => requestSort('lastSeen')}>
                                        <div className="flex items-center gap-2">
                                            Last Seen (IST) {renderSortIcon("lastSeen")}
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

                <ConfirmDialog
                    isOpen={isResetDialogOpen}
                    title="Reset report funnel metrics?"
                    message="This clears the current report funnel counters in KV so the 7-day card starts fresh. Historical values cannot be restored."
                    confirmText={isResettingFunnel ? "Resetting..." : "Reset Funnel"}
                    cancelText="Cancel"
                    confirmVariant="danger"
                    onCancel={() => {
                        if (!isResettingFunnel) {
                            setIsResetDialogOpen(false);
                        }
                    }}
                    onConfirm={() => {
                        if (!isResettingFunnel) {
                            void handleResetReportFunnel();
                        }
                    }}
                />

                <ConfirmDialog
                    isOpen={Boolean(deleteCandidate)}
                    title="Delete incomplete account?"
                    message={deleteCandidate
                        ? `Delete ${deleteCandidate.githubLogin ? `@${deleteCandidate.githubLogin}` : deleteCandidate.id.slice(0, 10)}. This permanently removes the incomplete account and any cascaded child rows.`
                        : ""}
                    confirmText={deletingUserId ? "Deleting..." : "Delete Account"}
                    cancelText="Cancel"
                    confirmVariant="danger"
                    onCancel={() => {
                        if (!deletingUserId) {
                            setDeleteCandidate(null);
                        }
                    }}
                    onConfirm={() => {
                        if (!deletingUserId) {
                            void handleDeleteAccount();
                        }
                    }}
                />
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

function MetricTile({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-3">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{value}</p>
        </div>
    );
}
