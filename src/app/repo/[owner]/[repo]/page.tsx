import { Metadata } from 'next';
import { headers } from 'next/headers';
import type { GitHubRepo, RepoCommit, RepoLanguage } from '@/lib/github';
import { getErrorStatus, getRepo, getRepoFullContext } from '@/lib/github';
import { cacheRepoUnavailable, getCachedRepoUnavailable } from '@/lib/cache';
import { isCuratedRepo } from '@/lib/repo-catalog';
import { ArrowLeft, Star, GitFork, AlertCircle, Clock, FileCode, Search, Lock, Home } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyBadge } from '@/components/CopyBadge';
import { normalizeReadmeForPreview } from './repo-page-utils';

interface Props {
    params: Promise<{
        owner: string;
        repo: string;
    }>;
}

export const revalidate = 900;

const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const CRAWLER_README_MAX_CHARS = 6000;

function isLikelyCrawler(userAgent: string): boolean {
    return /bot|crawl|spider|slurp|preview|facebookexternalhit|linkedinbot|whatsapp|telegram|discord/i.test(userAgent);
}

function isValidRepoSegment(value: string): boolean {
    if (!REPO_SEGMENT_PATTERN.test(value)) {
        return false;
    }

    if (value.startsWith('.') || value.endsWith('.') || value.endsWith('.git')) {
        return false;
    }

    return true;
}

function isValidOwnerRepo(owner: string, repo: string): boolean {
    return isValidRepoSegment(owner) && isValidRepoSegment(repo);
}

function buildRepoSignInHref(owner: string, repo: string): string {
    const callbackUrl = encodeURIComponent(`/repo/${owner}/${repo}`);
    return `/api/auth/signin?callbackUrl=${callbackUrl}`;
}

function buildCrawlerReadmeExcerpt(readme: string | null): string | null {
    if (!readme) return null;

    const plain = readme
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/^\s*\d+\.\s+/gm, "• ")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

    if (!plain) return null;
    if (plain.length <= CRAWLER_README_MAX_CHARS) return plain;
    return `${plain.slice(0, CRAWLER_README_MAX_CHARS).trim()}…`;
}

function RepoUnavailableState({ owner, repo }: { owner: string; repo: string }) {
    return (
        <main className="min-h-screen bg-black text-white p-6 md:p-12 overflow-x-hidden relative">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-purple-600/10 rounded-full blur-[80px] md:blur-[128px]" />
            </div>

            <div className="max-w-3xl mx-auto relative z-10">
                <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-10 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> back to home
                </Link>

                <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 md:p-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wide mb-5">
                        Repository unavailable
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold mb-4">We couldn&apos;t access this repository</h1>
                    <p className="text-zinc-300 leading-relaxed mb-6">
                        Repo path: <span className="font-semibold text-white">{owner}/{repo}</span>
                    </p>
                    <p className="text-zinc-400 leading-relaxed mb-8">
                        The repository may not exist, may be private, or the owner/repository name may be typed incorrectly.
                        Double-check the owner and repository name. To view private repositories, sign in with GitHub first.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <Link
                            href={buildRepoSignInHref(owner, repo)}
                            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors font-medium"
                        >
                            <Lock className="w-4 h-4" />
                            Sign in with GitHub
                        </Link>
                        <Link
                            href="/"
                            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800 transition-colors font-medium text-white"
                        >
                            <Home className="w-4 h-4" />
                            Go to homepage
                        </Link>
                    </div>
                </section>
            </div>
        </main>
    );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { owner, repo } = await params;
    const valid = isValidOwnerRepo(owner, repo);
    const curated = valid ? await isCuratedRepo(owner, repo) : false;
    const knownUnavailable = valid ? await getCachedRepoUnavailable(owner, repo) : false;
    const shouldIndex = curated && !knownUnavailable;

    return {
        title: `${owner}/${repo} - RepoMind`,
        description: `Analyze ${owner}/${repo} architecture, code quality, and security with RepoMind Agentic CAG.`,
        openGraph: {
            title: `${owner}/${repo} - RepoMind Analysis`,
            description: `Deep AI analysis for ${owner}/${repo}.`,
        },
        twitter: {
            card: 'summary_large_image',
            title: `${owner}/${repo} Architecture Analysis`,
            description: `Deep AI analysis for ${owner}/${repo}.`,
        },
        alternates: {
            canonical: `/repo/${owner}/${repo}`,
        },
        robots: shouldIndex
            ? { index: true, follow: true }
            : {
                index: false,
                follow: true,
                googleBot: {
                    index: false,
                    follow: true,
                },
            },
    };
}

export default async function RepoPage({ params }: Props) {
    const { owner, repo } = await params;

    if (!isValidOwnerRepo(owner, repo)) {
        return <RepoUnavailableState owner={owner} repo={repo} />;
    }

    if (await getCachedRepoUnavailable(owner, repo)) {
        return <RepoUnavailableState owner={owner} repo={repo} />;
    }

    let repoData: GitHubRepo;
    try {
        repoData = await getRepo(owner, repo);
    } catch (error) {
        if (getErrorStatus(error) === 404) {
            await cacheRepoUnavailable(owner, repo);
        }
        console.error('Failed repository existence check:', error);
        return <RepoUnavailableState owner={owner} repo={repo} />;
    }

    const userAgent = (await headers()).get('user-agent') || '';
    const isCrawler = isLikelyCrawler(userAgent);

    let detailsData: { languages: RepoLanguage[]; commits: RepoCommit[] } = { languages: [], commits: [] };
    let readmeContent: string | null = null;

    const result = await getRepoFullContext(owner, repo);
    
    if (!result.success) {
        if (result.status === 404) {
            await cacheRepoUnavailable(owner, repo);
        }
        console.error('Failed to load full repo context:', result.error);
        return <RepoUnavailableState owner={owner} repo={repo} />;
    }

    const context = result.data;
    repoData = context.metadata;
    detailsData = { languages: context.languages, commits: context.commits };
    readmeContent = context.readme;

    const fullReadme = normalizeReadmeForPreview(readmeContent);
    const crawlerReadmeExcerpt = isCrawler ? buildCrawlerReadmeExcerpt(fullReadme) : null;

    return (
        <main className="min-h-screen bg-black text-white p-6 md:p-12 overflow-x-hidden relative">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-purple-600/10 rounded-full blur-[80px] md:blur-[128px]" />
            </div>

            <div className="max-w-5xl mx-auto relative z-10">
                <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-8 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> back to home
                </Link>

                <header className="mb-12 border-b border-zinc-800 pb-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="w-full">
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                                <span className="text-zinc-400">{owner} / </span>
                                <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">{repoData.name}</span>
                            </h1>
                            {repoData.description && (
                                <p className="text-xl text-zinc-300 max-w-2xl">{repoData.description}</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 mt-8 text-sm text-zinc-400">
                        <div className="flex items-center">
                            <Star className="w-4 h-4 mr-2 text-yellow-500" />
                            {repoData.stargazers_count.toLocaleString()} stars
                        </div>
                        <div className="flex items-center">
                            <GitFork className="w-4 h-4 mr-2 text-blue-400" />
                            {repoData.forks_count.toLocaleString()} forks
                        </div>
                        <div className="flex items-center">
                            <AlertCircle className="w-4 h-4 mr-2 text-red-400" />
                            {repoData.open_issues_count.toLocaleString()} issues
                        </div>
                        <div className="flex items-center flex-wrap gap-2">
                            <FileCode className="w-4 h-4 mr-1 text-green-400" />
                            {detailsData.languages.slice(0, 3).map((lang) => (
                                <span key={lang.name} className="flex items-center mr-2">
                                    <span className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: lang.color ?? undefined }}></span>
                                    {lang.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row flex-wrap gap-4 mt-10">
                        <Link
                            href={`/chat?q=${owner}/${repo}`}
                            className="inline-flex items-center justify-center px-6 py-3.5 border border-transparent text-sm font-medium rounded-xl text-black bg-white hover:bg-zinc-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.4)]"
                        >
                            <FileCode className="w-4 h-4 mr-2" />
                            Chat with Codebase
                        </Link>
                        <Link
                            href={`/chat?q=${owner}/${repo}&prompt=architecture`}
                            className="inline-flex items-center justify-center px-6 py-3.5 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-sm font-medium rounded-xl text-white transition-colors"
                        >
                            <GitFork className="w-4 h-4 mr-2" />
                            Architecture Scan
                        </Link>
                        <Link
                            href={`/chat?q=${owner}/${repo}&prompt=security`}
                            className="inline-flex items-center justify-center px-6 py-3.5 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-sm font-medium rounded-xl text-white transition-colors"
                        >
                            <AlertCircle className="w-4 h-4 mr-2" />
                            Security Audit
                        </Link>
                        <Link
                            href={`/chat?q=${owner}/${repo}&prompt=explain`}
                            className="inline-flex items-center justify-center px-6 py-3.5 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-sm font-medium rounded-xl text-white transition-colors"
                        >
                            <Search className="w-4 h-4 mr-2 text-zinc-400" />
                            Explain Codebase
                        </Link>
                    </div>
                </header>

                <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 mb-12 backdrop-blur-sm">
                    <h2 className="text-2xl font-semibold mb-6 flex items-center">
                        <Star className="w-5 h-5 mr-3 text-purple-400" />
                        AI Architecture Analysis
                    </h2>
                    <p className="text-zinc-300 leading-relaxed mb-6">
                        This repository is indexed by RepoMind. By analyzing <strong>{owner}/{repo}</strong> in our AI interface,
                        you can instantly generate complete architecture diagrams, visualize control flows, and perform automated security audits across the entire codebase.
                    </p>
                    <p className="text-zinc-400 mb-6">
                        Our Agentic Context Augmented Generation (Agentic CAG) engine loads full source files into context on-demand, avoiding the fragmentation of traditional RAG systems.
                        Ask questions about the architecture, dependencies, or specific features to see it in action.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mb-6 bg-zinc-800/30 w-fit px-3 py-1.5 rounded-lg border border-zinc-700/30">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Source files are only loaded when you start an analysis to optimize performance.</span>
                    </div>
                    <div className="mt-8">
                        <Link
                            href={`/chat?q=${owner}/${repo}`}
                            className="text-purple-400 hover:text-purple-300 font-medium inline-flex items-center group"
                        >
                            Click here to launch the interactive analysis workspace
                            <ArrowLeft className="w-4 h-4 ml-2 rotate-180 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </section>

                <div className="mb-12">
                    <CopyBadge owner={owner} repo={repo} />
                </div>

                {isCrawler && crawlerReadmeExcerpt && (
                    <section className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-8 mb-12">
                        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-6">
                            <h2 className="text-xl font-medium text-zinc-300 uppercase tracking-wider text-sm">Repository Overview (README excerpt)</h2>
                            <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-1 rounded">Crawler view</span>
                        </div>
                        <p className="text-zinc-300 leading-relaxed whitespace-pre-line">
                            {crawlerReadmeExcerpt}
                        </p>
                    </section>
                )}

                {!isCrawler && fullReadme && (
                    <section className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-8 mb-12">
                        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-6">
                            <h2 className="text-xl font-medium text-zinc-300 uppercase tracking-wider text-sm">Repository Summary (README)</h2>
                            <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-1 rounded">Preview</span>
                        </div>

                        <div className="relative max-h-[400px] overflow-hidden">
                            <div className="prose prose-invert prose-zinc max-w-none prose-img:inline prose-img:m-0 prose-img:mr-1 prose-img:align-middle prose-p:leading-relaxed prose-a:text-blue-400 hover:prose-a:text-blue-300 prose-headings:font-semibold prose-h1:text-3xl prose-h2:text-2xl">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    skipHtml
                                >
                                    {fullReadme}
                                </ReactMarkdown>
                            </div>

                            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[rgb(12,12,14)] via-[rgb(12,12,14,0.8)] to-transparent pointer-events-none" />
                        </div>
                    </section>
                )}
            </div>
        </main >
    );
}
