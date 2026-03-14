"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { GitBranch, Loader2, CheckCircle2, FileCode, AlertCircle } from "lucide-react";
import { RepoLayout } from "./RepoLayout";
import { fetchGitHubData } from "@/app/actions";
import type { FileNode, GitHubRepo } from "@/lib/github";
import Link from "next/link";

interface LoadingStep {
    id: string;
    message: string;
    status: "loading" | "complete" | "error";
}

interface RepoLoaderProps {
    query: string;
    initialPrompt?: string;
}

interface RepoLoaderData {
    repo: GitHubRepo;
    fileTree: FileNode[];
    hiddenFiles: { path: string; reason: string }[];
}

const REPO_LOADER_CACHE_TTL_MS = 15 * 60 * 1000;

function getRepoLoaderCacheKey(query: string): string {
    return `repomind_repo_loader:${query.toLowerCase()}`;
}

function readCachedRepoLoaderData(query: string): RepoLoaderData | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(getRepoLoaderCacheKey(query));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { timestamp?: number; data?: RepoLoaderData };
        if (!parsed?.timestamp || !parsed?.data) return null;
        if (Date.now() - parsed.timestamp > REPO_LOADER_CACHE_TTL_MS) {
            window.sessionStorage.removeItem(getRepoLoaderCacheKey(query));
            return null;
        }
        return parsed.data;
    } catch {
        return null;
    }
}

function writeCachedRepoLoaderData(query: string, data: RepoLoaderData): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(
            getRepoLoaderCacheKey(query),
            JSON.stringify({ timestamp: Date.now(), data })
        );
    } catch {
        // Ignore storage errors to keep loading resilient.
    }
}

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return "Unknown error";
}

export function RepoLoader({ query, initialPrompt }: RepoLoaderProps) {
    const [steps, setSteps] = useState<LoadingStep[]>([]);
    const [repoData, setRepoData] = useState<RepoLoaderData | null>(null);
    const [error, setError] = useState<string | null>(null);

    const updateStep = (id: string, status: "loading" | "complete" | "error", message?: string) => {
        setSteps((prev) => {
            const existing = prev.find((s) => s.id === id);
            if (existing) {
                return prev.map((s) =>
                    s.id === id ? { ...s, status, message: message || s.message } : s
                );
            }
            return [...prev, { id, message: message || "", status }];
        });
    };

    const loadRepo = useCallback(async () => {
        try {
            const cached = readCachedRepoLoaderData(query);
            if (cached) {
                setRepoData(cached);
                return;
            }

            // Step 1: Fetch repo data
            updateStep("fetch", "loading", `Fetching repository ${query}...`);
            const data = await fetchGitHubData(query);

            if (data.error) {
                throw new Error(data.error);
            }

            if (data.type !== "repo") {
                throw new Error("Not a repository");
            }

            const repo = data.data as GitHubRepo;
            const fileTree = data.fileTree as FileNode[];
            const hiddenFiles = data.hiddenFiles || [];

            updateStep("fetch", "complete", "Repository data fetched");

            // Step 2: Analyze structure
            updateStep("analyze", "loading", `Analyzing ${fileTree.length} files...`);
            updateStep("analyze", "complete", "File structure analyzed");

            // Step 3: Prepare environment
            updateStep("env", "loading", "Preparing chat environment...");
            updateStep("env", "complete", "Ready to chat");

            const nextData = { repo, fileTree, hiddenFiles };
            setRepoData(nextData);
            writeCachedRepoLoaderData(query, nextData);

        } catch (err: unknown) {
            console.error(err);
            const rawErrorMessage = getErrorMessage(err);
            const errorMessage = rawErrorMessage === "User not found"
                ? `GitHub user/org for "${query}" not found`
                : rawErrorMessage === "Repository not found"
                    ? `Repository "${query}" not found`
                    : rawErrorMessage;

            setError(errorMessage);
            updateStep("error", "error", errorMessage);
        }
    }, [query]);

    useEffect(() => {
        void loadRepo();
    }, [loadRepo]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-4">
                <AlertCircle className="w-16 h-16 text-red-500" />
                <h1 className="text-2xl font-bold">Error Loading Repository</h1>
                <p className="text-zinc-400">{error}</p>
                <Link href="/" className="mt-4 px-6 py-3 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors">
                    Back to Home
                </Link>
            </div>
        );
    }

    if (!repoData) {
        return (
            <div className="flex items-center justify-center h-screen bg-black text-white">
                <div className="max-w-md w-full p-8">
                    <div className="mb-8 text-center">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mb-4 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-zinc-900 border border-white/10"
                        >
                            <GitBranch className="w-10 h-10 text-purple-400" />
                        </motion.div>
                        <h2 className="text-2xl font-bold mb-2">Loading Repository</h2>
                        <p className="text-sm text-zinc-500">{query}</p>
                    </div>

                    <div className="space-y-3">
                        {steps.map((step, index) => (
                            <motion.div
                                key={step.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-lg"
                            >
                                {step.status === "loading" && (
                                    <Loader2 className="w-5 h-5 text-purple-400 animate-spin shrink-0" />
                                )}
                                {step.status === "complete" && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                )}
                                {step.status === "error" && (
                                    <FileCode className="w-5 h-5 text-red-500 shrink-0" />
                                )}
                                <span className="text-sm text-zinc-300">{step.message}</span>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <RepoLayout
            fileTree={repoData.fileTree}
            repoName={repoData.repo.full_name}
            owner={repoData.repo.owner.login}
            repo={repoData.repo.name}
            hiddenFiles={repoData.hiddenFiles}
            repoData={repoData.repo}
            initialPrompt={initialPrompt}
        />
    );
}
