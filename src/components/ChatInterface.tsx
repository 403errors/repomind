"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, FileCode, ChevronRight, Bot, User, ArrowLeft, Sparkles, Github } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { processChatQuery } from "@/app/actions";
import { cn } from "@/lib/utils";
import mermaid from "mermaid";
import { EnhancedMarkdown } from "./EnhancedMarkdown";
import Link from "next/link";

// Initialize mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    themeVariables: {
        primaryColor: '#18181b', // zinc-900
        primaryTextColor: '#e4e4e7', // zinc-200
        primaryBorderColor: '#3f3f46', // zinc-700
        lineColor: '#a1a1aa', // zinc-400
        secondaryColor: '#27272a', // zinc-800
        tertiaryColor: '#27272a', // zinc-800
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }
});

const Mermaid = ({ chart }: { chart: string }) => {
    const [svg, setSvg] = useState<string>("");
    const id = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

    useEffect(() => {
        if (chart) {
            mermaid.render(id.current, chart).then(({ svg }) => {
                setSvg(svg);
            }).catch((error) => {
                console.error("Mermaid render error:", error);
                setSvg(`<div class="text-red-500 text-xs p-2">Failed to render diagram</div>`);
            });
        }
    }, [chart]);

    return <div className="my-4 overflow-x-auto bg-zinc-950/50 p-4 rounded-lg" dangerouslySetInnerHTML={{ __html: svg }} />;
};

const REPO_SUGGESTIONS = [
    "Show me the user flow chart",
    "Find security vulnerabilities",
    "Evaluate code quality",
    "What's the tech stack?",
    "Explain the architecture",
];

interface Message {
    id: string;
    role: "user" | "model";
    content: string;
    relevantFiles?: string[];
}

interface ChatInterfaceProps {
    repoContext: { owner: string; repo: string; fileTree: any[] };
}

export function ChatInterface({ repoContext }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "model",
            content: `Hello! I've analyzed **${repoContext.owner}/${repoContext.repo}**. Ask me anything about the code structure, dependencies, or specific features.`,
        },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSuggestionClick = (suggestion: string) => {
        setInput(suggestion);
        setShowSuggestions(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        setShowSuggestions(false);

        const userMsg: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setLoading(true);

        try {
            const filePaths = repoContext.fileTree.map((f: any) => f.path);
            const result = await processChatQuery(userMsg.content, {
                owner: repoContext.owner,
                repo: repoContext.repo,
                filePaths
            });

            const modelMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "model",
                content: result.answer,
                relevantFiles: result.relevantFiles,
            };

            setMessages((prev) => [...prev, modelMsg]);
        } catch (error) {
            console.error(error);
            // Handle error
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-black text-white">
            {/* Repo Header */}
            <div className="border-b border-white/10 px-6 py-4 bg-zinc-900/50 backdrop-blur-sm flex items-center gap-4">
                <Link
                    href="/"
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="Back to home"
                >
                    <ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" />
                </Link>
                <div className="flex items-center gap-3">
                    <Github className="w-5 h-5 text-zinc-400" />
                    <h1 className="text-lg font-semibold text-zinc-100">{repoContext.owner}/{repoContext.repo}</h1>
                </div>
                <a
                    href={`https://github.com/${repoContext.owner}/${repoContext.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-sm px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2"
                >
                    <Github className="w-4 h-4" />
                    View on GitHub
                </a>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn(
                                "flex gap-4 max-w-3xl mx-auto",
                                msg.role === "user" ? "flex-row-reverse" : "flex-row"
                            )}
                        >
                            <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
                                msg.role === "model"
                                    ? "bg-gradient-to-br from-purple-600 to-blue-600"
                                    : "bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10"
                            )}>
                                {msg.role === "model" ? (
                                    <Bot className="w-5 h-5 text-white" />
                                ) : (
                                    <User className="w-5 h-5 text-white" />
                                )}
                            </div>

                            <div className={cn(
                                "flex flex-col gap-2 max-w-[80%]",
                                msg.role === "user" ? "items-end" : "items-start"
                            )}>
                                <div className={cn(
                                    "p-4 rounded-2xl overflow-hidden",
                                    msg.role === "user"
                                        ? "bg-blue-600 text-white rounded-tr-none"
                                        : "bg-zinc-900 border border-white/10 rounded-tl-none"
                                )}>
                                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words overflow-hidden w-full">
                                        <EnhancedMarkdown
                                            content={msg.content}
                                            components={{
                                                code: ({ className, children, ...props }: any) => {
                                                    const match = /language-(\w+)/.exec(className || "");
                                                    const isMermaid = match && match[1] === "mermaid";

                                                    if (isMermaid) {
                                                        return <Mermaid chart={String(children).replace(/\n$/, "")} />;
                                                    }

                                                    return match ? (
                                                        <div className="overflow-auto w-full my-2 bg-black/50 p-2 rounded-lg">
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        </div>
                                                    ) : (
                                                        <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-red-400 font-mono text-sm" {...props}>
                                                            {children}
                                                        </code>
                                                    );
                                                },
                                                pre: ({ children }: any) => <>{children}</>,
                                                table: ({ children }: any) => (
                                                    <div className="overflow-x-auto my-4">
                                                        <table className="min-w-full border-collapse border border-zinc-700">
                                                            {children}
                                                        </table>
                                                    </div>
                                                ),
                                                thead: ({ children }: any) => (
                                                    <thead className="bg-zinc-800">{children}</thead>
                                                ),
                                                tbody: ({ children }: any) => (
                                                    <tbody className="bg-zinc-900/50">{children}</tbody>
                                                ),
                                                tr: ({ children }: any) => (
                                                    <tr className="border-b border-zinc-700">{children}</tr>
                                                ),
                                                th: ({ children }: any) => (
                                                    <th className="px-4 py-2 text-left text-sm font-semibold text-white border border-zinc-700">
                                                        {children}
                                                    </th>
                                                ),
                                                td: ({ children }: any) => (
                                                    <td className="px-4 py-2 text-sm text-zinc-300 border border-zinc-700">
                                                        {children}
                                                    </td>
                                                ),
                                            }}
                                        />
                                    </div>
                                </div>

                                {msg.relevantFiles && msg.relevantFiles.length > 0 && (
                                    <details className="group mt-1">
                                        <summary className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none">
                                            <FileCode className="w-3 h-3" />
                                            <span>{msg.relevantFiles.length} files analyzed</span>
                                            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                                        </summary>
                                        <ul className="mt-2 space-y-1 text-xs text-zinc-600 pl-4">
                                            {msg.relevantFiles.map((file, i) => (
                                                <li key={i} className="font-mono">{file}</li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {loading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-4 max-w-3xl mx-auto"
                    >
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shrink-0 shadow-lg animate-pulse">
                            <Bot className="w-5 h-5 text-white opacity-80" />
                        </div>
                        <div className="bg-zinc-900 border border-white/10 p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span className="text-zinc-400 text-sm">Analyzing code...</span>
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-white/10 bg-black/50 backdrop-blur-lg space-y-3">
                {/* Suggestions */}
                {showSuggestions && messages.length === 1 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-3xl mx-auto"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-purple-400" />
                            <span className="text-sm text-zinc-400">Try asking:</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {REPO_SUGGESTIONS.map((suggestion, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    className="text-sm px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-white/10 hover:border-purple-600/50 rounded-full text-zinc-300 hover:text-white transition-all"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask a question about the code..."
                        className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600/50 transition-all"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || loading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </form>
            </div>
        </div>
    );
}
