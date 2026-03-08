"use client";

import { useState, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { Search, Lock, Globe, BookOpen, ShieldAlert, GitFork, Loader2 } from "lucide-react";

interface Repo {
    name: string;
    full_name: string;
    private: boolean;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    updated_at: string;
}

export default function MyReposPage() {
    const { data: session } = useSession();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [hasPrivateAccess, setHasPrivateAccess] = useState(false);

    useEffect(() => {
        if (!session?.user) return;

        const fetchRepos = async () => {
            try {
                const res = await fetch("/api/dashboard/user-repos");
                const data = await res.json();

                if (data.repos) {
                    setRepos(data.repos);
                    setHasPrivateAccess(data.hasPrivateAccess);
                }
            } catch (error) {
                console.error("Failed to fetch user repos", error);
            } finally {
                setLoading(false);
            }
        };

        fetchRepos();
    }, [session]);

    const handleUnlockPrivateAccess = () => {
        signIn("github", { callbackUrl: "/dashboard/repos" }, { scope: "read:user user:email repo" });
    };

    const filteredRepos = repos.filter(repo =>
        repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const username = (session?.user as { username?: string } | undefined)?.username ?? "github_user";

    if (!session?.user) return null;

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-purple-500/30 bg-zinc-900 shrink-0">
                        {session.user.image ? (
                            <Image src={session.user.image} alt="User" width={64} height={64} className="object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-xl text-zinc-500">
                                {session.user.name?.[0] || "U"}
                            </div>
                        )}
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                            My Repositories
                        </h1>
                        <p className="text-zinc-400 mt-1">
                            {session.user.name} (@{username})
                        </p>
                    </div>
                </div>

                {!loading && !hasPrivateAccess && (
                    <button
                        onClick={handleUnlockPrivateAccess}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-all shadow-lg shadow-purple-500/20 text-sm font-medium"
                    >
                        <Lock className="w-4 h-4" />
                        Unlock Private Repos
                    </button>
                )}
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-blue-200/90 leading-relaxed text-sm">
                    <strong className="text-blue-300 font-semibold">Your code is yours.</strong> We don&apos;t train on or share your repository data. Your scan findings are stored securely to provide your history, and processing is handled on our secure server infrastructure.
                </p>
            </div>

            <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                    type="text"
                    placeholder="Search your repositories by name or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-12 pr-4 py-4 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 transition-colors shadow-lg"
                />
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 bg-zinc-900 border border-white/5 rounded-3xl">
                    <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
                    <p className="text-zinc-400">Loading your repositories...</p>
                </div>
            ) : filteredRepos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-zinc-900 border border-white/5 rounded-3xl text-center px-4">
                    <BookOpen className="w-12 h-12 text-zinc-600 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">No repositories found</h3>
                    <p className="text-zinc-500 max-w-sm">
                        {searchQuery ? "Try adjusting your search query." : "You don't have any public repositories yet."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredRepos.map(repo => (
                        <div
                            key={repo.full_name}
                            className="p-6 bg-zinc-900 border border-white/5 hover:border-white/10 rounded-2xl transition-all group flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-start justify-between mb-3">
                                    <h3 className="font-semibold text-lg text-white group-hover:text-purple-400 transition-colors line-clamp-1 flex-1 pr-4">
                                        {repo.name}
                                    </h3>
                                    {repo.private ? (
                                        <Lock className="w-5 h-5 text-zinc-500 shrink-0" />
                                    ) : (
                                        <Globe className="w-5 h-5 text-zinc-500 shrink-0" />
                                    )}
                                </div>
                                <p className="text-zinc-400 text-sm mb-6 line-clamp-2 min-h-[40px]">
                                    {repo.description || "No description provided."}
                                </p>
                            </div>

                            <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                                <div className="flex items-center gap-4 text-xs text-zinc-500">
                                    {repo.language && (
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                                            {repo.language}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <GitFork className="w-3.5 h-3.5" />
                                        {repo.forks_count}
                                    </div>
                                </div>

                                <Link
                                    href={`/chat?q=${encodeURIComponent(repo.full_name)}`}
                                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors group-hover:bg-purple-600 group-hover:text-white"
                                >
                                    <BookOpen className="w-3.5 h-3.5" />
                                    Analyze
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
