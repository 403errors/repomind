import { getAnalyticsData } from "@/lib/analytics";
import { Users, Activity, Smartphone, Monitor, Globe, Lock, Loader2, ArrowRight } from "lucide-react";

export const dynamic = 'force-dynamic'; // Ensure real-time data

import { headers, cookies } from "next/headers";
import AdminLoginPage from "./AdminLoginPage";

export default async function AdminStatsPage() {
    const cookieStore = await cookies();
    const isAdmin = cookieStore.get("admin_session")?.value === "authenticated";

    if (!isAdmin) {
        return <AdminLoginPage />;
    }

    const data = await getAnalyticsData();

    // Get current user debug info
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || "";
    let country = headersList.get("x-vercel-ip-country");
    if (!country && process.env.NODE_ENV === 'development') {
        country = "Local (Dev)";
    }
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || /Mobile/i.test(userAgent);

    return (
        <div className="min-h-screen bg-black text-white p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                        Analytics Dashboard
                    </h1>
                    <div className="text-sm text-zinc-400">
                        Last updated: {new Date().toLocaleTimeString()}
                    </div>
                </div>

                {/* Debug Card */}
                <div className="bg-zinc-900/50 border border-yellow-500/20 rounded-xl p-4 mb-8">
                    <h3 className="text-yellow-500 font-mono text-sm mb-2 uppercase tracking-wider">Your Current Session (Debug)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-mono text-zinc-400">
                        <div>
                            <span className="text-zinc-500">Detected Country:</span> <span className="text-white">{country || "Unknown"}</span>
                        </div>
                        <div>
                            <span className="text-zinc-500">Detected Device:</span> <span className={isMobile ? "text-orange-400" : "text-blue-400"}>{isMobile ? "Mobile" : "Desktop"}</span>
                        </div>
                        <div className="md:col-span-2 truncate">
                            <span className="text-zinc-500">User-Agent:</span> <span className="text-zinc-600" title={userAgent}>{userAgent}</span>
                        </div>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatsCard
                        title="Total Visitors"
                        value={data.totalVisitors}
                        icon={<Users className="w-5 h-5 text-purple-400" />}
                    />
                    <StatsCard
                        title="Total Queries"
                        value={data.totalQueries}
                        icon={<Activity className="w-5 h-5 text-blue-400" />}
                    />
                    <StatsCard
                        title="Active (24h)"
                        value={data.activeUsers24h}
                        icon={<Globe className="w-5 h-5 text-green-400" />}
                    />
                    <StatsCard
                        title="Mobile Users"
                        value={`${data.deviceStats.mobile || 0} (${Math.round(((data.deviceStats.mobile || 0) / (data.totalVisitors || 1)) * 100)}%)`}
                        icon={<Smartphone className="w-5 h-5 text-orange-400" />}
                    />
                </div>

                {/* Device & Country Split */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-6">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Monitor className="w-5 h-5 text-zinc-400" />
                            Device Breakdown
                        </h2>
                        <div className="space-y-3">
                            {Object.entries(data.deviceStats).map(([device, count]) => (
                                <div key={device} className="flex items-center justify-between">
                                    <span className="capitalize text-zinc-300">{device}</span>
                                    <div className="flex items-center gap-3">
                                        <div className="w-32 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500/50"
                                                style={{ width: `${(count / data.totalVisitors) * 100}%` }}
                                            />
                                        </div>
                                        <span className="font-mono text-sm text-zinc-400">{count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-6">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Globe className="w-5 h-5 text-zinc-400" />
                            Top Countries
                        </h2>
                        <div className="space-y-3">
                            {Object.entries(data.countryStats)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 5)
                                .map(([country, count]) => (
                                    <div key={country} className="flex items-center justify-between">
                                        <span className="text-zinc-300">{country}</span>
                                        <span className="font-mono text-sm text-zinc-400">{count}</span>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>

                {/* Visitors Table */}
                <div className="bg-zinc-900/50 border border-white/10 rounded-xl overflow-hidden">
                    <div className="p-6 border-b border-white/10">
                        <h2 className="text-xl font-semibold">Recent Visitors</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-900 text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-6 py-3">Visitor ID</th>
                                    <th className="px-6 py-3">Country</th>
                                    <th className="px-6 py-3">Device</th>
                                    <th className="px-6 py-3">Queries</th>
                                    <th className="px-6 py-3">Last Seen</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {data.recentVisitors.map((visitor) => (
                                    <tr key={visitor.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 font-mono text-xs text-zinc-500">
                                            {visitor.id.slice(0, 8)}...
                                        </td>
                                        <td className="px-6 py-4">{visitor.country}</td>
                                        <td className="px-6 py-4 capitalize">{visitor.device}</td>
                                        <td className="px-6 py-4 font-mono">{visitor.queryCount || 0}</td>
                                        <td className="px-6 py-4 text-zinc-400">
                                            {new Date(visitor.lastSeen).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {data.recentVisitors.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                                            No visitors recorded yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatsCard({ title, value, icon }: { title: string, value: string | number, icon: React.ReactNode }) {
    return (
        <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <div className="p-3 bg-white/5 rounded-lg">
                {icon}
            </div>
            <div>
                <div className="text-sm text-zinc-400">{title}</div>
                <div className="text-2xl font-bold text-white">{value}</div>
            </div>
        </div>
    );
}
