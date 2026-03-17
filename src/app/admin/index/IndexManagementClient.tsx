"use client";

import { useState } from "react";
import { Database, Hash, Search, ArrowUpRight, Star, Globe, TrendingUp, Clock, Calendar, BarChart3 } from "lucide-react";
import { CatalogRepoEntry, RepoTier } from "@/lib/repo-catalog";
import Link from "next/link";

interface Props {
  repos: CatalogRepoEntry[];
  topics: string[];
  stats: {
    totalRepos: number;
    totalTopics: number;
    tierCounts: Record<string, number>;
  };
}

export default function IndexManagementClient({ repos, topics, stats }: Props) {
  const [activeTab, setActiveTab] = useState<'repos' | 'topics'>('repos');
  const [repoSearch, setRepoSearch] = useState("");
  const [topicSearch, setTopicSearch] = useState("");
  const [selectedTier, setSelectedTier] = useState<RepoTier | 'all'>('all');

  const filteredRepos = repos.filter(repo => {
    const matchesSearch = (repo.owner + "/" + repo.repo).toLowerCase().includes(repoSearch.toLowerCase()) ||
                         (repo.description || "").toLowerCase().includes(repoSearch.toLowerCase());
    const matchesTier = selectedTier === 'all' || repo.tier === selectedTier;
    return matchesSearch && matchesTier;
  }).slice(0, 500); // Limit display for performance

  const filteredTopics = topics.filter(topic => 
    topic.toLowerCase().includes(topicSearch.toLowerCase())
  ).slice(0, 500);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Tier Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(Object.entries(stats.tierCounts) as [RepoTier, number][]).map(([tier, count]) => (
          <div key={tier} className="bg-zinc-900 shadow-sm border border-white/5 p-4 rounded-2xl">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">{tier}</div>
            <div className="text-xl font-bold">{count.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-white/5 pb-1">
        <button
          onClick={() => setActiveTab('repos')}
          className={`px-4 py-2 text-sm font-bold transition-all border-b-2 ${activeTab === 'repos' ? 'border-pink-500 text-white' : 'border-transparent text-zinc-500'}`}
        >
          Repositories ({stats.totalRepos.toLocaleString()})
        </button>
        <button
          onClick={() => setActiveTab('topics')}
          className={`px-4 py-2 text-sm font-bold transition-all border-b-2 ${activeTab === 'topics' ? 'border-pink-500 text-white' : 'border-transparent text-zinc-500'}`}
        >
          Topics ({stats.totalTopics.toLocaleString()})
        </button>
      </div>

      {activeTab === 'repos' ? (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search repos, owners, or descriptions..."
                className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:border-pink-500/50 transition-colors"
              />
            </div>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as RepoTier | 'all')}
              className="bg-zinc-900/50 border border-white/5 rounded-xl py-2.5 px-4 text-sm outline-none focus:border-pink-500/50 transition-colors"
            >
              <option value="all">All Tiers</option>
              <option value="all-time">All-Time</option>
              <option value="yearly">Yearly</option>
              <option value="6-month">6-Month</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-zinc-900/30">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Rank</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Repository</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Tier</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Stars</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Language</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-400 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRepos.map((repo) => (
                  <tr key={`${repo.owner}/${repo.repo}`} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4 text-sm font-mono text-zinc-600">#{repo.rank || '-'}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-white font-medium">{repo.owner}/{repo.repo}</span>
                        <span className="text-zinc-500 text-xs truncate max-w-[300px]">{repo.description}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        repo.tier === 'all-time' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                        repo.tier === 'weekly' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                        'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
                      }`}>
                        {repo.tier}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1 text-zinc-300">
                        <Star size={12} className="text-yellow-500" />
                        {repo.stars.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{repo.language || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/chat?q=${repo.owner}/${repo.repo}`}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-white hover:text-black transition-all inline-flex items-center gap-2"
                      >
                         <ArrowUpRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRepos.length === 0 && (
              <div className="p-12 text-center text-zinc-500 italic">No repositories found matching your query.</div>
            )}
            {repos.length > 500 && repoSearch === "" && selectedTier === 'all' && (
              <div className="p-4 text-center text-xs text-zinc-600 bg-white/5 border-t border-white/5">
                Showing top 500 repositories. Use search to find specific repos.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text"
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
              placeholder="Search indexable topics..."
              className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:border-pink-500/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredTopics.map((topic) => (
              <Link
                key={topic}
                href={`/topics/${encodeURIComponent(topic)}`}
                className="bg-zinc-900 border border-white/5 rounded-xl p-3 flex items-center justify-between hover:border-pink-500/30 group transition-all"
              >
                <span className="text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">{topic}</span>
                <ArrowUpRight size={14} className="text-zinc-600 group-hover:text-pink-500" />
              </Link>
            ))}
          </div>
          {filteredTopics.length === 0 && (
            <div className="p-12 text-center text-zinc-500 italic">No topics found matching your query.</div>
          )}
        </div>
      )}
    </div>
  );
}
