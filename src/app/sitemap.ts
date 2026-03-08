import { MetadataRoute } from "next";
import fs from "fs";
import path from "path";

export const dynamic = 'force-static';

interface TopRepoEntry {
    owner: string;
    repo: string;
}

function isTopRepoEntry(value: unknown): value is TopRepoEntry {
    return Boolean(
        value &&
        typeof value === "object" &&
        "owner" in value &&
        "repo" in value &&
        typeof (value as { owner?: unknown }).owner === "string" &&
        typeof (value as { repo?: unknown }).repo === "string"
    );
}

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://repomind.in";

    const defaultRoutes: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 1,
        },
        {
            url: `${baseUrl}/chat`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.9,
        }
    ];

    let repoRoutes: MetadataRoute.Sitemap = [];

    try {
            const dataPath = path.join(process.cwd(), 'public', 'data', 'top-repos.json');
            if (fs.existsSync(dataPath)) {
                const fileContent = fs.readFileSync(dataPath, 'utf8');
                const parsed: unknown = JSON.parse(fileContent);
                const repos = Array.isArray(parsed) ? parsed.filter(isTopRepoEntry) : [];

                repoRoutes = repos.map((repo) => ({
                    url: `${baseUrl}/repo/${repo.owner}/${repo.repo}`,
                    lastModified: new Date(),
                    changeFrequency: "weekly",
                    priority: 0.8,
                }));
            }
    } catch (e) {
        console.error("Failed to generate sitemap routes from top-repos.json", e);
    }

    return [...defaultRoutes, ...repoRoutes];
}
