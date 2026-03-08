"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchProfile, fetchRepoDetails } from "@/app/actions";
import { DeveloperCard } from "./DeveloperCard";
import { RepoCard } from "./RepoCard";
import { Loader2 } from "lucide-react";

interface SmartLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href?: string;
    currentOwner?: string;
    currentRepo?: string;
}

type LinkKind = "profile" | "repo" | "link" | "preview";

interface ProfilePreviewData {
    login: string;
    name?: string | null;
    avatar_url?: string;
    bio?: string | null;
    location?: string | null;
    blog?: string | null;
}

interface RepoPreviewData {
    name: string;
    owner: { login: string };
    description?: string | null;
    stargazers_count?: number;
    forks_count?: number;
    language?: string | null;
}

type PreviewData = ProfilePreviewData | RepoPreviewData;

function isProfilePreviewData(data: PreviewData): data is ProfilePreviewData {
    return "login" in data;
}

function isRepoPreviewData(data: PreviewData): data is RepoPreviewData {
    return "owner" in data;
}

export function SmartLink({ href, children, currentOwner, currentRepo, ...props }: SmartLinkProps) {
    const [data, setData] = useState<PreviewData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const linkMeta = useMemo(() => {
        if (!href) {
            return { type: "link" as LinkKind };
        }
        if (href.startsWith("#preview-")) {
            return { type: "preview" as LinkKind };
        }

        const githubUrlRegex = /^https:\/\/github\.com\/([a-zA-Z0-9-]+)(\/([a-zA-Z0-9-_\.]+))?$/;
        const match = href.match(githubUrlRegex);
        if (!match) {
            return { type: "link" as LinkKind };
        }

        const username = match[1];
        const repo = match[3];
        const isSameUser = currentOwner?.toLowerCase() === username.toLowerCase();
        const isSameRepo = isSameUser && repo && currentRepo?.toLowerCase() === repo.toLowerCase();

        if (repo) {
            if (isSameRepo) return { type: "link" as LinkKind };
            return { type: "repo" as LinkKind, username, repo };
        }

        if (isSameUser && !currentRepo) {
            return { type: "link" as LinkKind };
        }

        return { type: "profile" as LinkKind, username };
    }, [href, currentOwner, currentRepo]);

    useEffect(() => {
        if (linkMeta.type !== "profile" && linkMeta.type !== "repo") return;

        let cancelled = false;

        const run = async () => {
            setLoading(true);
            setError(false);
            setData(null);

            if (linkMeta.type === "repo" && linkMeta.username && linkMeta.repo) {
                fetchRepoDetails(linkMeta.username, linkMeta.repo)
                    .then((repoData) => {
                        if (!cancelled && repoData) {
                            setData(repoData as RepoPreviewData);
                        }
                    })
                    .catch(() => {
                        if (!cancelled) setError(true);
                    })
                    .finally(() => {
                        if (!cancelled) setLoading(false);
                    });
            } else if (linkMeta.type === "profile" && linkMeta.username) {
                fetchProfile(linkMeta.username)
                    .then((profileData) => {
                        if (!cancelled && profileData) {
                            setData(profileData as ProfilePreviewData);
                        }
                    })
                    .catch(() => {
                        if (!cancelled) setError(true);
                    })
                    .finally(() => {
                        if (!cancelled) setLoading(false);
                    });
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [linkMeta]);

    if (linkMeta.type === "link" || error) {
        return (
            <a href={href} {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                {children}
            </a>
        );
    }

    if (loading) {
        return (
            <span className="inline-flex items-center gap-2 text-zinc-400 bg-zinc-900 px-3 py-1 rounded-lg border border-zinc-800">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading preview...
            </span>
        );
    }

    if (linkMeta.type === "profile" && data && isProfilePreviewData(data)) {
        return (
            <div className="not-prose">
                <DeveloperCard
                    username={data.login}
                    name={data.name ?? undefined}
                    avatar={data.avatar_url ?? undefined}
                    bio={data.bio ?? undefined}
                    location={data.location || undefined}
                    blog={data.blog || undefined}
                />
            </div>
        );
    }

    if (linkMeta.type === "repo" && data && isRepoPreviewData(data)) {
        return (
            <div className="not-prose">
                <RepoCard
                    name={data.name}
                    owner={data.owner.login}
                    description={data.description ?? undefined}
                    stars={data.stargazers_count}
                    forks={data.forks_count}
                    language={data.language ?? undefined}
                />
            </div>
        );
    }

    if (linkMeta.type === "preview") {
        return (
            <button
                onClick={(e) => {
                    e.preventDefault();
                    const filePath = href?.replace("#preview-", "");
                    if (filePath) {
                        window.dispatchEvent(new CustomEvent('open-file-preview', { detail: filePath }));
                    }
                }}
                className="text-purple-400 hover:text-purple-300 hover:underline inline-flex items-center gap-1 cursor-pointer bg-transparent border-none p-0 font-mono text-sm"
                title="Open file preview"
            >
                {children}
            </button>
        );
    }

    return (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}
