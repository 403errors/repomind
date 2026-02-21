import { MetadataRoute } from "next";
import fs from "fs";
import path from "path";

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = "https://repomind-ai.vercel.app";

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
            const repos = JSON.parse(fileContent);

            repoRoutes = repos.map((repo: any) => ({
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
