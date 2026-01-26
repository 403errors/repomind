"use server";

import { getProfile, getRepo, getRepoFileTree, getFileContent, getProfileReadme, getReposReadmes, getFileContentBatch, getUserRepos, getRepoReadme } from "@/lib/github";
import { analyzeFileSelection, answerWithContext, answerWithContextStream } from "@/lib/gemini";
import { scanFiles, getScanSummary, groupBySeverity, type SecurityFinding, type ScanSummary } from "@/lib/security-scanner";
import { analyzeCodeWithGemini, generateSecurityPatch } from "@/lib/gemini-security";
import { countTokens } from "@/lib/tokens";
import type { StreamUpdate } from "@/lib/streaming-types";

export async function fetchGitHubData(input: string) {
    // Input format: "username" or "owner/repo"
    const parts = input.split("/");

    if (parts.length === 1) {
        // Profile Mode
        const username = parts[0];
        try {
            // We just return basic profile info here for the initial load
            // The rest will be loaded by the client component
            const profile = await getProfile(username);
            return { type: "profile", data: profile };
        } catch (e: any) {
            console.error("Profile fetch error:", e);
            return { error: `User not found: ${e.message || e}` };
        }
    } else if (parts.length === 2) {
        // Repo Mode
        const [owner, repo] = parts;
        try {
            const repoData = await getRepo(owner, repo);
            // Use the default branch from the repo data to avoid phantom files from stale 'main' branches
            const { tree, hiddenFiles } = await getRepoFileTree(owner, repo, repoData.default_branch);
            return { type: "repo", data: repoData, fileTree: tree, hiddenFiles };
        } catch (e: any) {
            console.error("Repo fetch error:", e);
            return { error: `Repository not found: ${e.message || e}` };
        }
    }

    return { error: "Invalid input format" };
}

export async function fetchProfile(username: string) {
    return await getProfile(username);
}

export async function fetchProfileReadme(username: string) {
    return await getProfileReadme(username);
}

export async function fetchUserRepos(username: string) {
    const repos = await getUserRepos(username);
    return repos.map((repo) => ({
        repo: repo.name,
        content: "", // Lazy load content
        updated_at: repo.updated_at,
        description: repo.description,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
    }));
}

export async function fetchRepoDetails(owner: string, repo: string) {
    return await getRepo(owner, repo);
}

export async function processChatQuery(
    query: string,
    repoContext: { owner: string; repo: string; filePaths: string[] },
    history: { role: "user" | "model"; content: string }[] = []
) {
    // Deprecated: Use analyzeRepoFiles + fetchRepoFiles + generateAnswer instead
    return { answer: "This function is deprecated. Please refresh the page.", relevantFiles: [] };
}

/**
 * Step 1: Analyze and select relevant files
 * This can be called first to show progress
 */
export async function analyzeRepoFiles(
    query: string,
    filePaths: string[],
    owner?: string,
    repo?: string
): Promise<{ relevantFiles: string[]; fileCount: number }> {
    // Prune the tree to remove noise (images, locks, etc.)
    // This reduces token usage and improves AI focus
    const prunedTree = filePaths.filter(path =>
        !path.match(/\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map)$/i) &&
        !path.includes('node_modules/') &&
        !path.includes('.git/')
    );

    const relevantFiles = await analyzeFileSelection(query, prunedTree, owner, repo);
    return { relevantFiles, fileCount: relevantFiles.length };
}

/**
 * Step 2: Fetch selected files with progress
 */
export async function fetchRepoFiles(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha: string }>
): Promise<{ context: string; filesProcessed: number }> {
    const fileResults = await getFileContentBatch(owner, repo, files);

    let context = "";
    let currentTokenCount = 0;
    const MAX_CONTEXT_TOKENS = 200000;

    for (const { path, content } of fileResults) {
        if (content) {
            const fileTokens = countTokens(content);

            if (currentTokenCount + fileTokens > MAX_CONTEXT_TOKENS) {
                context += `\n--- NOTE: Context truncated due to token limit (${MAX_CONTEXT_TOKENS} tokens) ---\n`;
                break;
            }

            context += `\n--- FILE: ${path} ---\n${content}\n`;
            currentTokenCount += fileTokens;
        }
    }

    if (!context) {
        context = "No specific files were selected.";
    }

    return { context, filesProcessed: fileResults.filter(f => f.content).length };
}

/**
 * Step 3: Generate AI response (server action wrapper)
 */
export async function generateAnswer(
    query: string,
    context: string,
    repoDetails: { owner: string; repo: string },
    history: { role: "user" | "model"; content: string }[] = [],
    profileData?: any, // Optional profile data
    visitorId?: string
): Promise<string> {
    // Track analytics
    try {
        // Skip tracking in development
        if (process.env.NODE_ENV === 'development') {
            console.log(`[Analytics] Skipped (Development Mode)`);
        } else if (visitorId) {
            const headersList = await headers();
            const userAgent = headersList.get("user-agent") || "";
            const country = headersList.get("x-vercel-ip-country") || "Unknown";
            const isMobile = /mobile/i.test(userAgent);

            await trackEvent(visitorId, 'query', {
                country,
                device: isMobile ? 'mobile' : 'desktop',
                userAgent
            });
        }
    } catch (e) {
        console.error("Analytics tracking failed:", e);
    }

    return await answerWithContext(query, context, repoDetails, profileData, history);
}

import { headers } from "next/headers";
import { trackEvent } from "@/lib/analytics";

export async function processProfileQuery(
    query: string,
    profileContext: {
        username: string;
        profile: any; // Full GitHub profile object
        profileReadme: string | null;
        repoReadmes: { repo: string; content: string; updated_at: string; description: string | null; stars: number; forks: number }[]
    },
    visitorId?: string,
    history: { role: "user" | "model"; content: string }[] = []
) {
    // Track analytics
    try {
        // Skip tracking in development
        if (process.env.NODE_ENV === 'development') {
            console.log(`[Analytics] Skipped (Development Mode)`);
        } else if (visitorId) {
            const headersList = await headers();
            const userAgent = headersList.get("user-agent") || "";
            const country = headersList.get("x-vercel-ip-country") || "Unknown";
            const isMobile = /mobile/i.test(userAgent);

            await trackEvent(visitorId, 'query', {
                country,
                device: isMobile ? 'mobile' : 'desktop',
                userAgent
            });
        }
    } catch (e) {
        console.error("Analytics tracking failed:", e);
    }

    // Build context from profile data, README and repo READMEs
    let context = "";

    // Add profile metadata first
    context += `\n--- GITHUB PROFILE METADATA ---\n`;
    context += `Username: ${profileContext.profile.login}\n`;
    context += `Name: ${profileContext.profile.name || 'N/A'}\n`;
    context += `Bio: ${profileContext.profile.bio || 'N/A'}\n`;
    context += `Location: ${profileContext.profile.location || 'N/A'}\n`;
    context += `Blog/Website: ${profileContext.profile.blog || 'N/A'}\n`;
    context += `Avatar URL: ${profileContext.profile.avatar_url}\n`;
    context += `Public Repos: ${profileContext.profile.public_repos}\n`;
    context += `Followers: ${profileContext.profile.followers}\n`;
    context += `Following: ${profileContext.profile.following}\n\n`;

    if (profileContext.profileReadme) {
        context += `\n--- ${profileContext.username}'S PROFILE README ---\n${profileContext.profileReadme}\n\n`;
    }

    // Add repo READMEs
    for (const readme of profileContext.repoReadmes) {
        let content = readme.content;
        // Lazy load if content is empty and repo is mentioned
        if (!content && query.toLowerCase().includes(readme.repo.toLowerCase())) {
            console.log(`Lazy loading README for ${readme.repo}`);
            content = await getRepoReadme(profileContext.username, readme.repo) || "";
        }

        if (content) {
            context += `\n--- REPO: ${readme.repo} ---\nLast Updated: ${readme.updated_at}\nDescription: ${readme.description || 'N/A'}\nStars: ${readme.stars}\nForks: ${readme.forks}\n\nREADME Content:\n${content}\n\n`;
        } else {
            context += `\n--- REPO: ${readme.repo} ---\nLast Updated: ${readme.updated_at}\nDescription: ${readme.description || 'N/A'}\nStars: ${readme.stars}\nForks: ${readme.forks}\n(README not loaded - ask about this repo to see more details)\n\n`;
        }
    }

    if (!context) {
        context = `No profile README or repository READMEs found for ${profileContext.username}.`;
    }

    // Answer using profile context, passing profile data for developer cards
    const answer = await answerWithContext(
        query,
        context,
        { owner: profileContext.username, repo: "profile" },
        profileContext.profile, // Pass profile data
        history // Pass conversation history
    );
    return { answer };
}

/**
 * Streaming variant of processProfileQuery
 */
export async function* processProfileQueryStream(
    query: string,
    profileContext: {
        username: string;
        profile: any;
        profileReadme: string | null;
        repoReadmes: { repo: string; content: string; updated_at: string; description: string | null; stars: number; forks: number }[]
    }
): AsyncGenerator<StreamUpdate> {
    try {
        yield { type: "status", message: "Loading profile data...", progress: 20 };

        let context = "";
        context += `\n--- GITHUB PROFILE METADATA ---\n`;
        context += `Username: ${profileContext.profile.login}\n`;
        context += `Name: ${profileContext.profile.name || 'N/A'}\n`;
        context += `Bio: ${profileContext.profile.bio || 'N/A'}\n`;
        context += `Location: ${profileContext.profile.location || 'N/A'}\n`;
        context += `Blog/Website: ${profileContext.profile.blog || 'N/A'}\n`;
        context += `Avatar URL: ${profileContext.profile.avatar_url}\n`;
        context += `Public Repos: ${profileContext.profile.public_repos}\n`;
        context += `Followers: ${profileContext.profile.followers}\n`;
        context += `Following: ${profileContext.profile.following}\n\n`;

        if (profileContext.profileReadme) {
            context += `\n--- ${profileContext.username}'S PROFILE README ---\n${profileContext.profileReadme}\n\n`;
        }

        yield { type: "status", message: "Analyzing repositories...", progress: 50 };

        for (const readme of profileContext.repoReadmes) {
            let content = readme.content;
            // Lazy load if content is empty and repo is mentioned
            if (!content && query.toLowerCase().includes(readme.repo.toLowerCase())) {
                yield { type: "status", message: `Reading ${readme.repo}...`, progress: 60 };
                content = await getRepoReadme(profileContext.username, readme.repo) || "";
            }

            if (content) {
                context += `\n--- REPO: ${readme.repo} ---\nLast Updated: ${readme.updated_at}\nDescription: ${readme.description || 'N/A'}\nStars: ${readme.stars}\nForks: ${readme.forks}\n\nREADME Content:\n${content}\n\n`;
            } else {
                context += `\n--- REPO: ${readme.repo} ---\nLast Updated: ${readme.updated_at}\nDescription: ${readme.description || 'N/A'}\nStars: ${readme.stars}\nForks: ${readme.forks}\n(README not loaded - ask about this repo to see more details)\n\n`;
            }
        }

        if (!context) {
            context = `No profile README or repository READMEs found for ${profileContext.username}.`;
        }

        yield { type: "status", message: "Thinking & Checking Real-time Data...", progress: 85 };
        // yield { type: "status", message: "Generating response...", progress: 90 }; // Removed to prevent overwriting the search status too quickly

        const stream = answerWithContextStream(
            query,
            context,
            { owner: profileContext.username, repo: "profile" },
            profileContext.profile
        );

        for await (const chunk of stream) {
            yield { type: "content", text: chunk, append: true };
        }

        yield { type: "complete", relevantFiles: [] };

    } catch (error: any) {
        console.error("Profile stream error:", error);
        yield { type: "error", message: error.message || "An error occurred" };
    }
}

/**
 * Scan repository for security vulnerabilities
 * Uses pattern-based detection + Gemini AI analysis
 */
export interface SecurityScanOptions {
    includePatterns?: string[];
    excludePatterns?: string[];
    maxFiles?: number;
    depth?: 'quick' | 'deep';
    enableAi?: boolean;
    aiMaxFiles?: number;
    filePaths?: string[];
}

function normalizePatterns(patterns?: string[]): string[] {
    if (!patterns) return [];
    return patterns.map(p => p.trim()).filter(Boolean);
}

function buildMatchers(patterns: string[]): RegExp[] {
    return patterns.map(pattern => {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        return new RegExp(escaped, 'i');
    });
}

function matchesAny(path: string, matchers: RegExp[]): boolean {
    return matchers.some((matcher) => matcher.test(path));
}

function scorePathRisk(path: string): number {
    const keywords = [
        'auth', 'login', 'oauth', 'jwt', 'token', 'session', 'admin',
        'middleware', 'api', 'route', 'controller', 'db', 'sql',
        'payment', 'billing', 'webhook', 'crypto', 'secret'
    ];
    const lower = path.toLowerCase();
    return keywords.reduce((score, keyword) => (lower.includes(keyword) ? score + 1 : score), 0);
}

function extractSnippet(content: string, line?: number, radius: number = 3): string {
    const lines = content.split('\n');
    if (lines.length === 0) return '';
    const index = line && line > 0 ? Math.min(line - 1, lines.length - 1) : 0;
    const start = Math.max(0, index - radius);
    const end = Math.min(lines.length, index + radius + 1);
    return lines.slice(start, end).map((text, i) => `${start + i + 1}| ${text}`).join('\n');
}

function attachSnippets(findings: SecurityFinding[], files: Array<{ path: string; content: string }>): SecurityFinding[] {
    const fileMap = new Map(files.map((f) => [f.path, f.content]));
    return findings.map((finding) => {
        const content = fileMap.get(finding.file);
        if (!content) return finding;
        const snippet = extractSnippet(content, finding.line);
        return { ...finding, snippet };
    });
}

export async function scanRepositoryVulnerabilities(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    options: SecurityScanOptions = {}
): Promise<{ findings: SecurityFinding[]; summary: ScanSummary; grouped: Record<string, SecurityFinding[]>; meta: { depth: 'quick' | 'deep'; aiEnabled: boolean; maxFiles: number; aiFilesSelected: number; durationMs: number } }> {
    try {
        const startedAt = Date.now();
        const depth = options.depth || 'quick';
        const maxFiles = options.maxFiles || (depth === 'deep' ? 60 : 20);
        const aiEnabled = options.enableAi !== false;
        const aiMaxFiles = options.aiMaxFiles || (depth === 'deep' ? 25 : 10);

        const includeMatchers = buildMatchers(normalizePatterns(options.includePatterns));
        const excludeMatchers = buildMatchers(normalizePatterns(options.excludePatterns));

        // Select relevant files for security scanning (focus on code files)
        const selectedPaths = options.filePaths ? new Set(options.filePaths) : null;

        const codeFiles = files.filter(f => {
            const isCode = /\.(js|jsx|ts|tsx|py|java|php|rb|go|rs)$/i.test(f.path) || f.path === 'package.json';
            if (!isCode) return false;
            if (selectedPaths && !selectedPaths.has(f.path)) return false;
            if (includeMatchers.length > 0 && !matchesAny(f.path, includeMatchers)) return false;
            if (excludeMatchers.length > 0 && matchesAny(f.path, excludeMatchers)) return false;
            return true;
        }).slice(0, maxFiles);

        console.log('🔍 Security Scan: Found', codeFiles.length, 'code files to scan');
        console.log('📁 Files to scan:', codeFiles.map(f => f.path));

        // Fetch file contents
        const filesWithContent: Array<{ path: string; content: string }> = [];
        for (const file of codeFiles) {
            try {
                const content = await getFileContent(owner, repo, file.path, file.sha);
                // Ensure content is a string (skip binary files)
                if (typeof content === 'string' && content.length > 0) {
                    filesWithContent.push({ path: file.path, content });
                    console.log('✅ Fetched:', file.path, `(${content.length} bytes)`);
                } else {
                    console.warn(`⚠️ Skipping ${file.path}: content is not a string or is empty`);
                }
            } catch (e) {
                console.warn(`❌ Failed to fetch ${file.path} for security scan:`, e);
            }
        }

        console.log('📄 Successfully fetched', filesWithContent.length, 'files for scanning');

        // Pattern-based scanning (fast, zero API costs)
        const patternFindings = scanFiles(filesWithContent);
        console.log('🔎 Pattern-based scan found', patternFindings.length, 'issues');

        // AI-powered analysis (more thorough, uses Gemini)
        let aiFindings: SecurityFinding[] = [];
        let aiFilesSelected = 0;
        if (aiEnabled) {
            try {
                const filesByRisk = [...filesWithContent].sort((a, b) => scorePathRisk(b.path) - scorePathRisk(a.path));
                const patternHitFiles = new Set(patternFindings.map(f => f.file));
                const aiCandidates: Array<{ path: string; content: string }> = [];

                for (const file of filesByRisk) {
                    if (patternHitFiles.has(file.path)) {
                        aiCandidates.push(file);
                    }
                }

                for (const file of filesByRisk) {
                    if (aiCandidates.length >= aiMaxFiles) break;
                    if (!aiCandidates.find(f => f.path === file.path)) {
                        aiCandidates.push(file);
                    }
                }

                const aiFiles = aiCandidates.slice(0, aiMaxFiles);
                aiFilesSelected = aiFiles.length;
                if (aiFiles.length > 0) {
                    aiFindings = await analyzeCodeWithGemini(aiFiles);
                    console.log('🤖 AI scan found', aiFindings.length, 'issues');
                }
            } catch (aiError) {
                console.warn('AI security analysis failed, continuing with pattern-based results only:', aiError);
                // Continue with pattern findings only if AI fails
            }
        }

        // Combine and deduplicate findings
        const allFindings = deduplicateFindings([...patternFindings, ...aiFindings]);
        console.log('🔗 Combined findings (before dedup):', patternFindings.length + aiFindings.length);
        console.log('🔗 After deduplication:', allFindings.length);

        // Filter by confidence (only show high/medium confidence)
        const filteredFindings = allFindings.filter(f =>
            !f.confidence || f.confidence !== 'low'
        );
        const findingsWithSnippets = attachSnippets(filteredFindings, filesWithContent);
        console.log('✨ After confidence filtering:', filteredFindings.length);
        console.log('📊 Final results:', filteredFindings);

        // Get summary and grouped results
        const summary = getScanSummary(filteredFindings);

        // Add debug info to summary
        summary.debug = {
            filesReceived: files.length,
            codeFilesFiltered: codeFiles.length,
            filesSuccessfullyFetched: filesWithContent.length,
            patternFindings: patternFindings.length,
            aiFindings: aiFindings.length,
            afterDedup: allFindings.length,
            afterConfidenceFilter: filteredFindings.length
        };

        const grouped = groupBySeverity(findingsWithSnippets);

        const durationMs = Date.now() - startedAt;
        const meta = {
            depth,
            aiEnabled,
            maxFiles,
            aiFilesSelected,
            durationMs
        };

        return { findings: findingsWithSnippets, summary, grouped, meta };
    } catch (error: any) {
        console.error('Vulnerability scanning error:', error);
        // Provide more detailed error message
        const errorMessage = error?.message || 'Unknown error occurred';
        throw new Error(`Failed to scan repository for vulnerabilities: ${errorMessage}`);
    }
}

export async function generateSecurityPatchForFinding(
    owner: string,
    repo: string,
    finding: SecurityFinding
): Promise<{ patch: string; explanation: string }> {
    try {
        const content = await getFileContent(owner, repo, finding.file);
        const snippet = typeof content === 'string' ? extractSnippet(content, finding.line) : '';
        const result = await generateSecurityPatch({
            filePath: finding.file,
            fileContent: typeof content === 'string' ? content : '',
            line: finding.line,
            description: finding.description,
            recommendation: finding.recommendation,
            snippet
        });
        return result;
    } catch (error: any) {
        console.error('Generate security patch failed:', error);
        return { patch: '', explanation: 'Failed to generate patch.' };
    }
}


/**
 * Deduplicate findings based on file, line, and title
 */
function deduplicateFindings(findings: SecurityFinding[]): SecurityFinding[] {
    const seen = new Set<string>();
    return findings.filter(f => {
        const key = `${f.file}:${f.line || 0}:${f.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// --- Final Phase Actions ---

import { analyzeCodeQuality, type QualityReport } from "@/lib/quality-analyzer";
import { searchFiles, type SearchResult, type SearchOptions } from "@/lib/search-engine";
import { generateDocumentation, generateTests, suggestRefactoring } from "@/lib/generator";

export async function analyzeFileQuality(owner: string, repo: string, path: string): Promise<QualityReport | null> {
    try {
        const content = await getFileContent(owner, repo, path);

        const wordCount = content.split(/\s+/).length;
        if (wordCount > 5000) {
            throw new Error("File is too large (over 5000 words)");
        }

        return await analyzeCodeQuality(content, path);
    } catch (error) {
        console.error("Quality analysis failed:", error);
        return null;
    }
}

export async function searchRepositoryCode(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    query: string,
    type: 'text' | 'regex' | 'ast' = 'text'
): Promise<SearchResult[]> {
    try {
        // Limit search to 50 files to prevent timeout
        const searchFilesList = files.slice(0, 50);
        const filesWithContent = [];

        for (const file of searchFilesList) {
            try {
                // Skip non-code files for AST search
                if (type === 'ast' && !/\.(js|jsx|ts|tsx)$/.test(file.path)) continue;

                const content = await getFileContent(owner, repo, file.path, file.sha);
                filesWithContent.push({ path: file.path, content });
            } catch (e) {
                // Skip failed files
            }
        }

        return searchFiles(filesWithContent, { query, type });
    } catch (error) {
        console.error("Search failed:", error);
        return [];
    }
}

export async function generateArtifact(
    owner: string,
    repo: string,
    path: string,
    type: 'doc' | 'test' | 'refactor'
): Promise<string> {
    try {
        const content = await getFileContent(owner, repo, path);

        const wordCount = content.split(/\s+/).length;
        if (wordCount > 5000) {
            return "Error: File is too large (over 5000 words)";
        }

        switch (type) {
            case 'doc':
                return await generateDocumentation(content);
            case 'test':
                return await generateTests(content);
            case 'refactor':
                return await suggestRefactoring(content);
            default:
                return "Invalid type";
        }
    } catch (error) {
        return "Failed to generate artifact";
    }
}
