import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Settings, Users, ArrowRight, BarChart2, Globe, Activity, Database, Hash } from "lucide-react";
import { getAllPosts } from "@/lib/services/blog-service";
import { getAnalyticsData } from "@/lib/analytics";
import { getCatalogStats } from "@/lib/repo-catalog";

export default async function AdminDashboardPage() {
  const session = await auth();
  
  if (!isAdminUser(session)) {
    redirect("/");
  }

  const [posts, analytics, catalogStats] = await Promise.all([
    getAllPosts(),
    getAnalyticsData(),
    getCatalogStats(),
  ]);

  const publishedCount = posts.filter((p: any) => p.published).length;
  const draftCount = posts.length - publishedCount;

  const stats = [
    { label: "Total Posts", value: posts.length.toString(), icon: FileText, color: "text-blue-400" },
    { label: "Curated Repos", value: catalogStats.totalRepos.toLocaleString(), icon: Database, color: "text-purple-400" },
    { label: "Indexable Topics", value: catalogStats.totalTopics.toLocaleString(), icon: Hash, color: "text-pink-400" },
    { label: "Total Visitors", value: analytics.totalVisitors.toString(), icon: Users, color: "text-orange-400" },
    { label: "Total Queries", value: analytics.totalQueries.toString(), icon: Activity, color: "text-cyan-400" },
  ];

  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
            Admin Command Center
          </h1>
          <p className="text-zinc-400 max-w-2xl">
            Unified management for RepoMind content, analytics, and system performance.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold text-green-400 uppercase tracking-wider">System Live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-2 rounded-xl bg-white/5 ${stat.color}`}>
                <stat.icon size={20} />
              </div>
            </div>
            <div className="text-2xl font-bold mb-1">{stat.value}</div>
            <div className="text-zinc-500 text-sm font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Link 
          href="/admin/blog"
          className="group relative bg-zinc-900/40 border border-white/5 rounded-3xl p-8 hover:bg-zinc-900/60 hover:border-purple-500/30 transition-all overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 text-zinc-800/20 group-hover:text-purple-500/10 transition-colors">
            <FileText size={120} />
          </div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
            <FileText className="text-purple-400" />
            Blog CMS
          </h2>
          <p className="text-zinc-400 mb-6 relative z-10 max-w-md text-sm leading-relaxed">
            Manage your articles and drafts. Published {publishedCount} posts across {posts.length} total.
          </p>
          <div className="flex items-center gap-2 text-zinc-300 font-bold group-hover:gap-4 transition-all mt-auto pt-4 shadow-sm">
            Manage Posts <ArrowRight size={18} />
          </div>
        </Link>

        <Link 
          href="/admin/index"
          className="group relative bg-zinc-900/40 border border-white/5 rounded-3xl p-8 hover:bg-zinc-900/60 hover:border-pink-500/30 transition-all overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 text-zinc-800/20 group-hover:text-pink-500/10 transition-colors">
            <Database size={120} />
          </div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
            <Database className="text-pink-400" />
            Index Manager
          </h2>
          <p className="text-zinc-400 mb-6 relative z-10 max-w-md text-sm leading-relaxed">
            Audit {catalogStats.totalRepos.toLocaleString()} repositories and {catalogStats.totalTopics.toLocaleString()} topics across multiple tiers.
          </p>
          <div className="flex items-center gap-2 text-zinc-300 font-bold group-hover:gap-4 transition-all mt-auto pt-4 shadow-sm">
            Manage Index <ArrowRight size={18} />
          </div>
        </Link>

        <Link 
          href="/admin/stats"
          className="group relative bg-zinc-900/40 border border-white/5 rounded-3xl p-8 hover:bg-zinc-900/60 hover:border-blue-500/30 transition-all overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 text-zinc-800/20 group-hover:text-blue-500/10 transition-colors">
            <BarChart2 size={120} />
          </div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
            <BarChart2 className="text-blue-400" />
            Analytics
          </h2>
          <p className="text-zinc-400 mb-6 relative z-10 max-w-md text-sm leading-relaxed">
            Monitor real-time visitor activity, storage usage, and engagement metrics.
          </p>
          <div className="flex items-center gap-2 text-zinc-300 font-bold group-hover:gap-4 transition-all mt-auto pt-4 shadow-sm">
            View Stats <ArrowRight size={18} />
          </div>
        </Link>
      </div>
    </div>
  );
}
