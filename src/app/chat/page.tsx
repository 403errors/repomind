import { Suspense } from "react";
import { fetchGitHubData } from "../actions";
import { ProfileLoader } from "@/components/ProfileLoader";
import { RepoLayout } from "@/components/RepoLayout";
import { Loader2, AlertCircle, ArrowLeft, Github, Search } from "lucide-react";
import { GitHubRepo } from "@/lib/github";
import Link from "next/link";

export default async function ChatPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q: query } = await searchParams;

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

    // For repos, we still fetch server-side for now
    const data = await fetchGitHubData(query);

    if (data.error) {
        const errorMessage = data.error === "User not found"
            ? `GitHub user "${query}" was not found. Please check the username.`
            : data.error === "Repository not found"
                ? `Repository "${query}" was not found. Please verify the owner/repo format.`
                : data.error;

        return (
            <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-4">
                <AlertCircle className="w-16 h-16 text-red-500" />
                <h1 className="text-3xl font-bold">Not Found</h1>
                <p className="text-zinc-400 text-center max-w-md">{errorMessage}</p>
                <div className="flex gap-3 mt-4">
                    <Link href="/" className="px-6 py-3 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-2">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </Link>
                    <a
                        href={`https://github.com/${query}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-3 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors flex items-center gap-2"
                    >
                        <Github className="w-4 h-4" />
                        View on GitHub
                    </a>
                </div>
            </div>
        );
    }

    if (data.type === "profile") {
        // This path might not be reached now for initial load, but good to keep as fallback
        return <ProfileLoader username={query} />;
    }

    if (data.type !== "repo") {
        return null;
    }

    // Explicit cast or just usage since we checked type
    const repoData = data.data as GitHubRepo;
    const fileTree = data.fileTree as any[];

    return (
        <RepoLayout
            fileTree={fileTree}
            repoName={repoData.full_name}
            owner={repoData.owner.login}
            repo={repoData.name}
        />
    );
}
