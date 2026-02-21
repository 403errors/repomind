'use client';

import { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';

interface CopyBadgeProps {
    owner: string;
    repo: string;
}

export function CopyBadge({ owner, repo }: CopyBadgeProps) {
    const [copied, setCopied] = useState(false);

    const markdownSnippet = `[![Analyzed by RepoMind](https://img.shields.io/badge/Analyzed%20by-RepoMind-4F46E5?style=for-the-badge)](https://repomind-ai.vercel.app/repo/${owner}/${repo})`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(markdownSnippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="flex flex-col gap-4 p-6 bg-zinc-900/40 border border-zinc-800/80 rounded-xl backdrop-blur-md shadow-lg w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                        <Code2 className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-zinc-200">Embed this Badge</h3>
                        <p className="text-xs text-zinc-400 mt-0.5">Showcase RepoMind's analysis directly in your repository's README.</p>
                    </div>
                </div>
                <button
                    onClick={handleCopy}
                    className="group relative flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white transition-all bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 rounded-lg overflow-hidden shrink-0"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 to-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {copied ? (
                        <>
                            <Check className="w-4 h-4 text-green-400 relative z-10" />
                            <span className="text-green-400 relative z-10">Copied to Clipboard!</span>
                        </>
                    ) : (
                        <>
                            <Copy className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors relative z-10" />
                            <span className="relative z-10">Copy Markdown</span>
                        </>
                    )}
                </button>
            </div>

            <div className="relative group mt-2">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative p-4 bg-black/60 border border-zinc-800/80 rounded-lg font-mono text-xs text-zinc-400 break-all select-all">
                    {markdownSnippet}
                </div>
            </div>

            <div className="flex items-center gap-4 mt-1 bg-black/20 p-3 rounded-lg border border-white/5">
                <span className="text-zinc-500 uppercase tracking-wider text-xs font-semibold">Preview:</span>
                <a href={`https://repomind-ai.vercel.app/repo/${owner}/${repo}`} target="_blank" rel="noopener noreferrer" className="block transform hover:scale-105 transition-transform drop-shadow-[0_0_12px_rgba(79,70,229,0.2)] hover:drop-shadow-[0_0_16px_rgba(79,70,229,0.4)]">
                    <img
                        src="https://img.shields.io/badge/Analyzed%20by-RepoMind-4F46E5?style=for-the-badge"
                        alt="Analyzed by RepoMind"
                        className="h-7"
                    />
                </a>
            </div>
        </div>
    );
}
