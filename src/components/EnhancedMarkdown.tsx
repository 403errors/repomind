"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { RepoCard } from "./RepoCard";
import { DeveloperCard } from "./DeveloperCard";
import { SmartLink } from "./SmartLink";
import { Mermaid } from "./Mermaid";
import { DynamicSVG } from "./DynamicSVG";
import { FileIcon, FolderIcon } from "./FileIcon";
import { generateMermaidFromJSON } from "@/lib/diagram-utils";

interface ParsedContent {
    type: "markdown" | "repo-card" | "developer-card";
    content: string | Record<string, string>;
}

/**
 * Parse a string that may contain custom card blocks (repo-card / developer-card)
 * and split it into an ordered list of markdown fragments and card data.
 */
export function parseCardContent(text: string): ParsedContent[] {
    const parts: ParsedContent[] = [];
    let currentIndex = 0;
    const cardRegex = /:::(repo-card|developer-card)\n([\s\S]*?):::/g;
    let match: RegExpExecArray | null;

    while ((match = cardRegex.exec(text)) !== null) {
        // Push any preceding markdown
        if (match.index > currentIndex) {
            const markdown = text.slice(currentIndex, match.index).trim();
            if (markdown) {
                parts.push({ type: "markdown", content: markdown });
            }
        }
        const cardType = match[1] as "repo-card" | "developer-card";
        const cardBody = match[2];
        const cardData: Record<string, string> = {};
        cardBody.split("\n").forEach((line) => {
            const [key, ...rest] = line.split(":");
            if (key && rest.length) {
                cardData[key.trim()] = rest.join(":").trim();
            }
        });
        parts.push({ type: cardType, content: cardData });
        currentIndex = match.index + match[0].length;
    }

    // Remaining markdown after last card
    if (currentIndex < text.length) {
        const markdown = text.slice(currentIndex).trim();
        if (markdown) {
            parts.push({ type: "markdown", content: markdown });
        }
    }

    return parts;
}

interface EnhancedMarkdownProps {
    content: string;
    components?: Components;
    currentOwner?: string;
    currentRepo?: string;
    isStreaming?: boolean;
    fileTree?: { path: string }[];
}

export function EnhancedMarkdown({ content, components, currentOwner, currentRepo, isStreaming = false, fileTree = [] }: EnhancedMarkdownProps) {
    const parts = useMemo(() => parseCardContent(content), [content]);
    
    const resolvePath = (path: string, isFolder: boolean) => {
        if (!fileTree || fileTree.length === 0) return path;
        
        // Exact match
        if (fileTree.some(f => f.path === path)) return path;
        
        // Find all matches that end with the given path
        const matches = fileTree.filter(f => f.path.endsWith('/' + path) || f.path === path);
        if (matches.length === 1) return matches[0].path;
        
        if (matches.length > 1) {
            // Priority 1: src or lib
            const priorityMatch = matches.find(m => m.path.startsWith('src/') || m.path.startsWith('lib/'));
            if (priorityMatch) return priorityMatch.path;
            
            // Priority 2: Not tests
            const nonTestMatch = matches.find(m => !m.path.includes('test'));
            if (nonTestMatch) return nonTestMatch.path;
            
            // Priority 3: Shortest path (usually more likely to be the main one)
            return matches.sort((a, b) => a.path.length - b.path.length)[0].path;
        }

        // For folders, we can also check if any file starts with that path
        if (isFolder) {
            const prefixMatch = fileTree.find(f => f.path.startsWith(path + '/'));
            if (prefixMatch) return path; // Folder exists as a prefix
        }

        return path;
    };

    const mergedComponents = useMemo(() => ({
        a: (props: any) => (
            <SmartLink
                {...props}
                currentOwner={currentOwner}
                currentRepo={currentRepo}
            />
        ),
        img: (props: any) => {
            const { src, alt, ...rest } = props;
            if (!src) return null;
            return (
                <span className="block my-6 rounded-xl overflow-hidden border border-white/10">
                    <img src={src} alt={alt || ""} {...rest} className="w-full h-auto object-cover" />
                </span>
            );
        },
        code(props: any) {
            const { children, className, node, ...rest } = props;
            const match = /language-([\w-]+)/.exec(className || "");
            const isMermaid = match && match[1] === "mermaid";
            const isMermaidJson = match && match[1] === "mermaid-json";
            const childrenStr = String(children).replace(/\n$/, "");
            
            if (isMermaid) {
                return (
                    <Mermaid 
                        chart={childrenStr} 
                        isStreaming={isStreaming} 
                    />
                );
            }

            if (match && match[1] === "svg") {
                return (
                    <DynamicSVG 
                        svg={childrenStr} 
                        isStreaming={isStreaming} 
                    />
                );
            }

            if (isMermaidJson) {
                try {
                    const chart = generateMermaidFromJSON(JSON.parse(childrenStr));
                    if (chart) {
                        return (
                            <Mermaid
                                chart={chart}
                                isStreaming={isStreaming}
                            />
                        );
                    }
                } catch {
                    // Fall through to the raw JSON fallback below.
                }

                return (
                    <pre className="my-4 overflow-x-auto rounded-lg border border-white/10 bg-zinc-900/60 p-4 text-xs text-zinc-300 whitespace-pre-wrap">
                        {childrenStr}
                    </pre>
                );
            }

            // Detect if this is likely a file or folder path
            const hasExtension = /\.(ts|tsx|js|jsx|py|md|css|json|yaml|yml|sh|html|go|rs|java|c|cpp|h|sql|env|json)$/.test(childrenStr);
            const hasSlash = childrenStr.includes('/');
            const isKnownFolder = ['src', 'lib', 'app', 'components', 'pages', 'public', 'tests', 'docs'].includes(childrenStr.toLowerCase());
            
            const isFilePath = !match && hasExtension && !childrenStr.includes(' ') && childrenStr.length > 2;
            const isFolder = !match && !isFilePath && (
                childrenStr.endsWith('/') || 
                (hasSlash && !childrenStr.includes(' ')) ||
                isKnownFolder
            ) && childrenStr.length > 2;
            
            if (isFilePath) {
                const fullPath = resolvePath(childrenStr, false);
                const exists = fileTree.length > 0 && fileTree.some(f => f.path === fullPath);
                
                if (exists) {
                    return (
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                window.dispatchEvent(new CustomEvent('open-file-preview', { detail: fullPath }));
                            }}
                            className="inline-flex items-center gap-1.5 bg-zinc-800/30 hover:bg-zinc-700/50 px-1.5 py-0.5 rounded border border-white/5 text-sm font-mono text-purple-300 hover:text-purple-200 transition-all cursor-pointer group"
                            title={`Open ${fullPath}`}
                        >
                            <FileIcon filename={childrenStr} className="w-3.5 h-3.5" />
                            {children}
                            <span className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-500">↗</span>
                        </button>
                    );
                }
            }

            if (isFolder) {
                const baseFolder = childrenStr.endsWith('/') ? childrenStr.slice(0, -1) : childrenStr;
                const fullFolderPath = resolvePath(baseFolder, true);
                const exists = fileTree.length > 0 && (
                    fileTree.some(f => f.path === fullFolderPath) || 
                    fileTree.some(f => f.path.startsWith(fullFolderPath + '/'))
                );

                if (exists) {
                    return (
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                window.dispatchEvent(new CustomEvent('reveal-folder', { detail: fullFolderPath }));
                            }}
                            className="inline-flex items-center gap-1.5 bg-zinc-800/30 hover:bg-zinc-700/50 px-1.5 py-0.5 rounded border border-white/5 text-sm font-mono text-blue-300 hover:text-blue-200 transition-all cursor-pointer group"
                            title={`Reveal ${fullFolderPath}`}
                        >
                            <FolderIcon name={childrenStr} isExpanded={false} className="w-3.5 h-3.5" />
                            {children}
                            <span className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-500">↗</span>
                        </button>
                    );
                }
            }
            
            return (
                <code className={className || "bg-zinc-800/30 px-1.5 py-0.5 rounded border border-white/5 text-sm font-mono text-zinc-300"} {...rest}>
                    {children}
                </code>
            );
        },
        p: ({ children }: any) => <div className="mb-6 last:mb-0 leading-relaxed">{children}</div>,
        ...components
    }), [currentOwner, currentRepo, components, fileTree, isStreaming, resolvePath]);

    return (
        <>
            {parts.map((part: ParsedContent, index: number) => {
                if (part.type === "markdown") {
                    return (
                        <ReactMarkdown
                            key={index}
                            components={mergedComponents}
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw, rehypeSanitize]}
                        >
                            {part.content as string}
                        </ReactMarkdown>
                    );
                }
                if (part.type === "repo-card") {
                    const data = part.content as Record<string, string>;

                    // Filter out current repo card
                    const isSameUser = currentOwner?.toLowerCase() === data.owner?.toLowerCase();
                    const isSameRepo = isSameUser && currentRepo?.toLowerCase() === data.name?.toLowerCase();
                    if (isSameRepo) return null;

                    return (
                        <RepoCard
                            key={index}
                            owner={data.owner || ""}
                            name={data.name || ""}
                            description={data.description}
                            stars={data.stars ? parseInt(data.stars) : undefined}
                            forks={data.forks ? parseInt(data.forks) : undefined}
                            language={data.language}
                        />
                    );
                }
                if (part.type === "developer-card") {
                    const data = part.content as Record<string, string>;

                    // Filter out current developer card
                    const isSameUser = currentOwner?.toLowerCase() === data.username?.toLowerCase();
                    if (isSameUser && !currentRepo) return null;

                    return (
                        <DeveloperCard
                            key={index}
                            username={data.username || ""}
                            name={data.name}
                            avatar={data.avatar}
                            bio={data.bio}
                            location={data.location}
                            blog={data.blog}
                        />
                    );
                }
                return null;
            })}
        </>
    );
}
