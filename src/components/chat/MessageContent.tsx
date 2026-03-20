import { memo, useMemo, type HTMLAttributes, type ReactNode } from "react";

import { EnhancedMarkdown } from "@/components/EnhancedMarkdown";
import { Mermaid } from "@/components/Mermaid";
import { DynamicSVG } from "@/components/DynamicSVG";
import { CodeBlock } from "@/components/CodeBlock";
import { generateMermaidFromJSON } from "@/lib/diagram-utils";
import { repairMarkdown } from "@/lib/markdown-utils";
import { Loader2 } from "lucide-react";

interface MessageIdentity {
    id: string;
}

interface MessageContentProps {
    content: string;
    messageId: string;
    messages?: MessageIdentity[];
    currentOwner?: string;
    currentRepo?: string;
    isStreaming?: boolean;
    fileTree?: { path: string }[];
}

interface MarkdownCodeProps extends HTMLAttributes<HTMLElement> {
    className?: string;
    children?: ReactNode;
    inline?: boolean;
}

interface MarkdownContainerProps {
    children?: ReactNode;
}

function stripEliteSvgBanner(content: string): string {
    return content
        .replace(
            /(?:^|\n)\s*Applying Elite SVG 2\.0 System:\s*\[✓\]\s*Smooth SMIL Splines\s*\[✓\]\s*Precise Bead Math\s*\[✓\]\s*Premium Defs Applied\.?\s*(?:\n|$)/gi,
            "\n"
        )
        .trimStart();
}

function MessageContentBase({
    content,
    messageId,
    messages = [],
    currentOwner,
    currentRepo,
    isStreaming = false,
    fileTree = [],
}: MessageContentProps) {
    const repairedContent = useMemo(
        () => repairMarkdown(stripEliteSvgBanner(content)),
        [content]
    );
    const isStreamingMessage = isStreaming;

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
            
            // Priority 3: Shortest path
            return matches.sort((a, b) => a.path.length - b.path.length)[0].path;
        }

        // For folders, we can also check if any file starts with that path
        if (isFolder) {
            const prefixMatch = fileTree.find(f => f.path.startsWith(path + '/'));
            if (prefixMatch) return path; // Folder exists as a prefix
        }

        return path;
    };

    const components = useMemo(() => ({
        code: ({ className, children, inline, ...props }: MarkdownCodeProps) => {
            const match = /language-([\w-]+)/.exec(className ?? "");
            const isMermaid = match?.[1] === "mermaid";
            const isMermaidJson = match?.[1] === "mermaid-json";

            if (isMermaid) {
                return (
                    <Mermaid
                        chart={String(children).replace(/\n$/, "")}
                        isStreaming={isStreamingMessage}
                    />
                );
            }

            if (match?.[1] === "svg") {
                return (
                    <DynamicSVG
                        svg={String(children).replace(/\n$/, "")}
                        isStreaming={isStreamingMessage}
                    />
                );
            }

            if (isMermaidJson) {
                const jsonContent = String(children).replace(/\n$/, "");
                try {
                    const chart = generateMermaidFromJSON(JSON.parse(jsonContent));
                    if (chart) {
                        return <Mermaid chart={chart} isStreaming={isStreamingMessage} />;
                    }
                } catch {
                    // Fall through to code rendering below.
                }

                if (isStreamingMessage) {
                    return (
                        <div className="flex items-center gap-2 p-4 bg-zinc-900/50 rounded-lg border border-white/10">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span className="text-zinc-400 text-sm">Generating diagram...</span>
                        </div>
                    );
                }

                return (
                    <CodeBlock
                        language="json"
                        value={jsonContent}
                        components={components}
                        owner={currentOwner}
                        repo={currentRepo}
                    />
                );
            }

            const childrenStr = String(children ?? "").replace(/\n$/, "");
            const isBlock = childrenStr.endsWith("\n");
            const shouldRenderBlock = Boolean(match) || isBlock || inline === false;

            if (shouldRenderBlock) {
                return (
                    <CodeBlock
                        language={match?.[1] ?? "markdown"}
                        value={childrenStr}
                        components={components}
                        owner={currentOwner}
                        repo={currentRepo}
                    />
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
                            className="bg-zinc-800/30 hover:bg-zinc-700/50 px-1.5 py-0.5 rounded border border-white/5 text-sm font-mono text-purple-300 hover:text-purple-200 transition-all cursor-pointer group"
                            title={`Open ${fullPath}`}
                        >
                            {children}
                            <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-500">↗</span>
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
                            className="bg-zinc-800/30 hover:bg-zinc-700/50 px-1.5 py-0.5 rounded border border-white/5 text-sm font-mono text-blue-300 hover:text-blue-200 transition-all cursor-pointer group"
                            title={`Reveal ${fullFolderPath}`}
                        >
                            {children}
                            <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-500">📁</span>
                        </button>
                    );
                }
            }

            return (
                <code
                    className="bg-zinc-800/30 px-1.5 py-0.5 rounded border border-white/5 text-zinc-300 font-mono text-sm"
                    {...props}
                >
                    {children}
                </code>
            );
        },
        p: ({ children }: MarkdownContainerProps) => (
            <p className="mb-4 leading-relaxed last:mb-0">{children}</p>
        ),
        pre: ({ children }: MarkdownContainerProps) => <>{children}</>,
        table: ({ children }: MarkdownContainerProps) => (
            <div className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border border-zinc-700">{children}</table>
            </div>
        ),
        thead: ({ children }: MarkdownContainerProps) => (
            <thead className="bg-zinc-800">{children}</thead>
        ),
        tbody: ({ children }: MarkdownContainerProps) => (
            <tbody className="bg-zinc-900/50">{children}</tbody>
        ),
        tr: ({ children }: MarkdownContainerProps) => (
            <tr className="border-b border-zinc-700">{children}</tr>
        ),
        th: ({ children }: MarkdownContainerProps) => (
            <th className="px-4 py-2 text-left text-sm font-semibold text-white border border-zinc-700">
                {children}
            </th>
        ),
        td: ({ children }: MarkdownContainerProps) => (
            <td className="px-4 py-2 text-sm text-zinc-300 border border-zinc-700">{children}</td>
        ),
    }), [currentOwner, currentRepo, isStreamingMessage, fileTree, resolvePath]);

    return (
        <div className="w-full [&>*:first-child]:!mt-0">
            <EnhancedMarkdown
                content={repairedContent}
                components={components}
                currentOwner={currentOwner}
                currentRepo={currentRepo}
                isStreaming={isStreaming}
                fileTree={fileTree}
            />
        </div>
    );
}

export const MessageContent = memo(MessageContentBase, (prev, next) => (
    prev.content === next.content &&
    prev.messageId === next.messageId &&
    prev.currentOwner === next.currentOwner &&
    prev.currentRepo === next.currentRepo &&
    prev.isStreaming === next.isStreaming &&
    prev.fileTree === next.fileTree
));
