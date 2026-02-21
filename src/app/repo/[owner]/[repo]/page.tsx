import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRepo, getRepoDetailsGraphQL, getRepoReadme } from '@/lib/github';
import { ArrowLeft, Star, GitFork, AlertCircle, Clock, FileCode, Search } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyBadge } from '@/components/CopyBadge';

interface Props {
    params: Promise<{
        owner: string;
        repo: string;
    }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { owner, repo } = await params;

    try {
        const data = await getRepo(owner, repo);
        return {
            title: `${data.name} by ${data.owner.login} - RepoMind Architecture & Analysis`,
            description: data.description
                ? `Analyze the architecture, code quality, and security of ${data.full_name}. ${data.description}`
                : `Deep AI analysis and visualization of ${data.full_name} using RepoMind CAG Engine.`,
            openGraph: {
                title: `${data.full_name} - RepoMind Analysis`,
                description: data.description || `AI analysis for ${data.full_name}`,
            },
            twitter: {
                card: 'summary_large_image',
                title: `${data.full_name} Architecture Analysis`,
                description: data.description || '',
            }
        };
    } catch (error) {
        return {
            title: `${owner}/${repo} - RepoMind`,
        };
    }
}

export default async function RepoPage({ params }: Props) {
    const { owner, repo } = await params;

    let repoData;
    let detailsData;
    let readmeContent;

    try {
        // Fetch critical data
        repoData = await getRepo(owner, repo);
        detailsData = await getRepoDetailsGraphQL(owner, repo);
        readmeContent = await getRepoReadme(owner, repo);
    } catch (error) {
        console.error("Failed to load repo data:", error);
        notFound();
    }

    // Fallback metadata if partial failure
    if (!repoData) notFound();

    // Basic markdown sanitizer for the README summary to ensure safe, clean rendering
    // We take the first 1500 characters of the README to serve as an SEO-rich overview
    const shortReadme = readmeContent
        ? readmeContent.substring(0, 1500) + (readmeContent.length > 1500 ? '...\n\n*[View full documentation in repository]*' : '')
        : '';

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
                            {detailsData?.languages?.slice(0, 3).map((lang: any) => (
                                <span key={lang.name} className="flex items-center mr-2">
                                    <span className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: lang.color }}></span>
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
                    <p className="text-zinc-400 italic text-sm">
                        Our Context-Aware Generation (CAG) engine loads full source files into context, avoiding the fragmentation of traditional RAG systems.
                    </p>
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

                {shortReadme && (
                    <section className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-8 mb-12">
                        <h2 className="text-xl font-medium text-zinc-300 mb-6 uppercase tracking-wider text-sm border-b border-zinc-800 pb-2">Repository Summary (README)</h2>
                        <div className="prose prose-invert prose-blue max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {shortReadme}
                            </ReactMarkdown>
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}
