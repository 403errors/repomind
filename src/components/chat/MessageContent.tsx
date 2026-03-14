import { useMemo, type HTMLAttributes, type ReactNode } from "react";

import { EnhancedMarkdown } from "@/components/EnhancedMarkdown";
import { Mermaid } from "@/components/Mermaid";
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
}

interface MarkdownCodeProps extends HTMLAttributes<HTMLElement> {
    className?: string;
    children?: ReactNode;
    inline?: boolean;
}

interface MarkdownContainerProps {
    children?: ReactNode;
}

export function MessageContent({
    content,
    messageId,
    messages = [],
    currentOwner,
    currentRepo,
    isStreaming = false,
}: MessageContentProps) {
    const repairedContent = useMemo(() => repairMarkdown(content), [content]);
    const isStreamingMessage = isStreaming || messages[messages.length - 1]?.id === messageId;

    const components = {
        code: ({ className, children, inline, ...props }: MarkdownCodeProps) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const isMermaid = match?.[1] === "mermaid";
            const isMermaidJson = match?.[1] === "mermaid-json";

            if (isMermaid) {
                return (
                    <Mermaid
                        key={messageId}
                        chart={String(children).replace(/\n$/, "")}
                        isStreaming={isStreamingMessage}
                    />
                );
            }

            if (isMermaidJson) {
                try {
                    const jsonContent = String(children).replace(/\n$/, "");
                    const chart = generateMermaidFromJSON(JSON.parse(jsonContent));
                    return <Mermaid key={messageId} chart={chart} isStreaming={isStreamingMessage} />;
                } catch {
                    return (
                        <div className="flex items-center gap-2 p-4 bg-zinc-900/50 rounded-lg border border-white/10">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span className="text-zinc-400 text-sm">Generating diagram...</span>
                        </div>
                    );
                }
            }

            const contentStr = String(children ?? "");
            const isBlock = contentStr.endsWith("\n");
            const shouldRenderBlock = Boolean(match) || isBlock || inline === false;

            return shouldRenderBlock ? (
                <CodeBlock
                    language={match?.[1] ?? "markdown"}
                    value={contentStr.replace(/\n$/, "")}
                    components={components}
                    owner={currentOwner}
                    repo={currentRepo}
                />
            ) : (
                <code
                    className="bg-zinc-800 px-1.5 py-0.5 rounded text-red-400 font-mono text-sm"
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
    };

    return (
        <div className="w-full [&>*:first-child]:!mt-0">
            <EnhancedMarkdown
                content={repairedContent}
                components={components}
                currentOwner={currentOwner}
                currentRepo={currentRepo}
            />
        </div>
    );
}
