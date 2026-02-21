import * as fs from "fs";
import * as path from "path";
// Manually parse .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            let key = match[1];
            let value = match[2] || "";
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            process.env[key] = value;
        }
    });
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
    console.error("❌ GITHUB_TOKEN environment variable is not set. Exiting.");
    process.exit(1);
}

const RANGES = [
    "stars:>50000",
    "stars:25000..50000",
    "stars:15000..25000",
    "stars:10000..15000",
    "stars:7000..10000",
    "stars:5000..7000",
    "stars:4000..5000",
    "stars:3000..4000",
    "stars:2000..3000",
    "stars:1000..2000"
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTopRepos() {
    const allRepos: any[] = [];
    const uniqueRepos = new Set<string>();

    console.log("🚀 Starting to fetch top GitHub repositories...");

    for (const range of RANGES) {
        let page = 1;
        let keepGoing = true;

        console.log(`\\n🔍 Fetching range: ${range}`);

        while (keepGoing) {
            try {
                const query = `is:public ${range}`;
                const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100&page=${page}`;

                const response = await fetch(url, {
                    headers: {
                        "Authorization": `token ${githubToken}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "RepoMind-Script"
                    }
                });

                if (!response.ok) {
                    if (response.status === 403) {
                        console.log("   ⏳ Rate limit hit! Waiting 30 seconds before retrying...");
                        await sleep(30000);
                        continue; // try exact same request again
                    }
                    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
                }

                const data: any = await response.json();
                const items = data.items || [];

                if (items.length === 0) {
                    keepGoing = false;
                    break;
                }

                for (const repo of items) {
                    const key = `${repo.owner?.login}/${repo.name}`;
                    if (!uniqueRepos.has(key)) {
                        uniqueRepos.add(key);
                        allRepos.push({
                            owner: repo.owner?.login,
                            repo: repo.name,
                            stars: repo.stargazers_count,
                            description: repo.description,
                            topics: repo.topics || [],
                            language: repo.language
                        });
                    }
                }

                console.log(`   ✅ Page ${page} - Added ${items.length} repos (Total: ${allRepos.length})`);

                if (items.length < 100 || page >= 10) {
                    keepGoing = false;
                } else {
                    page++;
                    await sleep(2000);
                }
            } catch (error: any) {
                console.error("   ❌ Error fetching repositories:", error.message);
                keepGoing = false;
            }
        }

        if (allRepos.length >= 5000) {
            console.log(`🎯 Reached target of 5000+ repositories! Stopping.`);
            break;
        }
    }

    const publicDataDir = path.resolve(process.cwd(), "public/data");
    if (!fs.existsSync(publicDataDir)) {
        fs.mkdirSync(publicDataDir, { recursive: true });
    }

    const outputPath = path.resolve(publicDataDir, "top-repos.json");
    const finalSet = allRepos.slice(0, 5000);

    fs.writeFileSync(outputPath, JSON.stringify(finalSet, null, 2));

    console.log(`\\n🎉 Successfully grabbed ${finalSet.length} repositories!`);
    console.log(`💾 Saved to ${outputPath}`);
}

fetchTopRepos().catch(console.error);
