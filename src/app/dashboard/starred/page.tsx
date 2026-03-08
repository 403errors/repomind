import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Star, ExternalLink, GitFork, BookOpen, AlertCircle } from "lucide-react";
import { getStarredRepos } from "@/lib/github";
import Link from "next/link";

export default async function StarredPage() {
    const session = await auth();

    if (!session?.user) {
        redirect("/");
    }

    const username =
        (session.user as { username?: string }).username ??
        session.user.name ??
        session.user.email?.split('@')[0];
    const starredRepos = username ? await getStarredRepos(username) : [];

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Star className="w-8 h-8 text-yellow-500" />
                    <div>
                        <h1 className="text-3xl font-bold">Starred Repositories</h1>
                        <p className="text-zinc-400 mt-1">Public repositories starred by @{username}</p>
                    </div>
                </div>
                <a
                    href={`https://github.com/${username}?tab=stars`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-white/5 hover:bg-zinc-800 text-white rounded-xl transition-all text-sm"
                >
                    View on GitHub
                    <ExternalLink className="w-4 h-4" />
                </a>
            </div>

            {starredRepos.length === 0 ? (
                <div className="rounded-3xl bg-zinc-900 border border-white/5 p-12 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
                        <AlertCircle className="w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-semibold">No Starred Repositories</h2>
                    <p className="text-zinc-500 max-w-md mx-auto">
                        We couldn&apos;t find any public starred repositories for your account. Go star some interesting projects on GitHub!
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {starredRepos.map((repo) => (
                        <div
                            key={repo.full_name}
                            className="p-6 rounded-2xl bg-zinc-900 border border-white/5 hover:border-white/10 transition-colors group flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-start justify-between mb-3">
                                    <h3 className="font-semibold text-lg text-white group-hover:text-purple-400 transition-colors line-clamp-1 flex-1 pr-4">
                                        <a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                            {repo.name}
                                        </a>
                                    </h3>
                                    <Star className="w-5 h-5 text-yellow-500 fill-yellow-500 shrink-0" />
                                </div>
                                <p className="text-zinc-400 text-sm mb-4 line-clamp-2 min-h-[40px]">
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
                                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <BookOpen className="w-3.5 h-3.5" />
                                    Scan
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
