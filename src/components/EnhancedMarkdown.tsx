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
}

export function EnhancedMarkdown({ content, components, currentOwner, currentRepo, isStreaming = false }: EnhancedMarkdownProps) {
    const parts = useMemo(() => parseCardContent(content), [content]);
    
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
            const match = /language-(\w+)/.exec(className || "");
            const isMermaid = match && match[1] === "mermaid";
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
            
            return (
                <code className={className || "bg-zinc-800/50 px-1.5 py-0.5 rounded text-sm font-mono text-purple-300"} {...rest}>
                    {children}
                </code>
            );
        },
        p: ({ children }: any) => <div className="mb-6 last:mb-0 leading-relaxed">{children}</div>,
        ...components
    }), [currentOwner, currentRepo, components]);

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
