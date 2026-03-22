import { ProfileLoader } from "@/components/ProfileLoader";
import { RepoLoader } from "@/components/RepoLoader";
import { redirect } from "next/navigation";
import { normalizeGitHubInput } from "@/lib/utils";
import { getProfile, getRepo } from "@/lib/github";
import {
    buildOgImageUrl,
    buildProfileChatTitle,
    buildRepoChatTitle,
    chatIntentDescription,
    createSeoMetadata,
    inferChatIntent,
    truncateMetaText,
} from "@/lib/seo";

import type { Metadata } from "next";

function buildChatRobots(): NonNullable<Metadata["robots"]> {
    return {
        index: false,
        follow: true,
        googleBot: {
            index: false,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
            "max-snippet": -1,
        },
    };
}

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; prompt?: string }>;
}): Promise<Metadata> {
    const { q: rawQuery, prompt } = await searchParams;
    const query = rawQuery ? normalizeGitHubInput(rawQuery) : "";
    const intent = inferChatIntent(prompt);

    if (!query) {
        const metadata = createSeoMetadata({
            title: "Chat",
            description: "Paste a GitHub repository or developer profile to analyze it with RepoMind.",
            canonical: "/chat",
            ogTitle: "RepoMind chat",
            ogDescription: "Chat with GitHub repositories and developer profiles using Agentic CAG.",
        });
        metadata.robots = buildChatRobots();
        return metadata;
    }

    const canonicalQuery = prompt
        ? `/chat?q=${encodeURIComponent(query)}&prompt=${encodeURIComponent(prompt)}`
        : `/chat?q=${encodeURIComponent(query)}`;

    if (!query.includes("/")) {
        try {
            const profile = await getProfile(query);
            const title = buildProfileChatTitle(query, profile.name, intent);
            const description = profile.bio
                ? `${truncateMetaText(profile.bio, 130)} Use RepoMind to explore projects, skills, and contributions.`
                : `${chatIntentDescription(intent)} Explore their projects, skills, and contributions with RepoMind.`;

            const metadata = createSeoMetadata({
                title,
                description,
                canonical: canonicalQuery,
                ogImage: buildOgImageUrl("profile", {
                    username: query,
                    name: profile.name,
                    bio: profile.bio,
                    repos: profile.public_repos,
                    followers: profile.followers,
                    following: profile.following,
                    mode: intent,
                }),
                ogTitle: title,
                ogDescription: description,
            });
            metadata.robots = buildChatRobots();
            return metadata;
        } catch {
            const title = buildProfileChatTitle(query, undefined, intent);
            const description = `${chatIntentDescription(intent)} Explore their projects, skills, and contributions with RepoMind.`;
            const metadata = createSeoMetadata({
                title,
                description,
                canonical: canonicalQuery,
                ogImage: buildOgImageUrl("profile", {
                    username: query,
                    mode: intent,
                }),
                ogTitle: title,
                ogDescription: description,
            });
            metadata.robots = buildChatRobots();
            return metadata;
        }
    }

    const [owner, repo] = query.split("/");
    try {
        const repoData = await getRepo(owner, repo);
        const title = buildRepoChatTitle(owner, repo, intent);
        const description = repoData.description
            ? `${chatIntentDescription(intent)} ${truncateMetaText(repoData.description, 120)}`
            : `${chatIntentDescription(intent)} Ask about architecture, dependencies, and implementation details.`;

        const metadata = createSeoMetadata({
            title,
            description,
            canonical: canonicalQuery,
            ogImage: buildOgImageUrl("repo", {
                owner,
                repo,
                description: repoData.description,
                stars: repoData.stargazers_count,
                forks: repoData.forks_count,
                language: repoData.language,
                mode: intent,
            }),
            ogTitle: title,
            ogDescription: description,
        });
        metadata.robots = buildChatRobots();
        return metadata;
    } catch {
        const title = buildRepoChatTitle(owner, repo, intent);
        const description = `${chatIntentDescription(intent)} Ask about architecture, dependencies, and implementation details.`;
        const metadata = createSeoMetadata({
            title,
            description,
            canonical: canonicalQuery,
            ogImage: buildOgImageUrl("repo", {
                owner,
                repo,
                mode: intent,
            }),
            ogTitle: title,
            ogDescription: description,
        });
        metadata.robots = buildChatRobots();
        return metadata;
    }
}

export default async function ChatPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; prompt?: string }>;
}) {
    const { q: rawQuery, prompt } = await searchParams;
    const query = rawQuery ? normalizeGitHubInput(rawQuery) : undefined;

    if (!query) {
        redirect("/");
    }

    // If it's a profile query (no slash), load immediately with ProfileLoader
    if (!query.includes("/")) {
        return <ProfileLoader username={query} />;
    }

    // For repos, use RepoLoader for client-side loading
    return <RepoLoader query={query} initialPrompt={prompt} />;
}
