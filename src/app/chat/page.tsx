import { Suspense } from "react";
import { fetchGitHubData } from "../actions";
import { ProfileLoader } from "@/components/ProfileLoader";
import { RepoLoader } from "@/components/RepoLoader";
import { RepoLayout } from "@/components/RepoLayout";
import { Loader2, AlertCircle, ArrowLeft, Github, Search } from "lucide-react";
import { GitHubRepo } from "@/lib/github";
import Link from "next/link";

export default async function ChatPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; prompt?: string }>;
}) {
    const { q: query, prompt } = await searchParams;

    if (!query) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-4">
                <Search className="w-12 h-12 text-zinc-600" />
                <h1 className="text-2xl font-bold">No Query Provided</h1>
                <p className="text-zinc-400">Please search for a GitHub user or repository</p>
                <Link href="/" className="mt-4 px-6 py-3 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Home
                </Link>
            </div>
        );
    }

    // If it's a profile query (no slash), load immediately with ProfileLoader
    if (!query.includes("/")) {
        return <ProfileLoader username={query} />;
    }

    // For repos, use RepoLoader for client-side loading
    return <RepoLoader query={query} initialPrompt={prompt} />;
}
