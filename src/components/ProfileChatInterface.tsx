import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, Github, MapPin, Link as LinkIcon, Users, BookMarked, ArrowLeft, Sparkles, MessageCircle, Trash2, Download, X } from "lucide-react";
import { BotIcon } from "@/components/icons/BotIcon";
import { UserIcon } from "@/components/icons/UserIcon";
import { CopySquaresIcon } from "@/components/icons/CopySquaresIcon";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { processProfileQuery } from "@/app/actions";
import { cn } from "@/lib/utils";
import { GitHubProfile } from "@/lib/github";
import { EnhancedMarkdown } from "./EnhancedMarkdown";
import { countMessageTokens, formatTokenCount, getTokenWarningLevel, isRateLimitError, getRateLimitErrorMessage, MAX_TOKENS } from "@/lib/tokens";
import { validateMermaidSyntax, sanitizeMermaidCode, getFallbackTemplate, generateMermaidFromJSON } from "@/lib/diagram-utils";
import { saveProfileConversation, loadProfileConversation, clearProfileConversation } from "@/lib/storage";
import { exportChatToMarkdownFile, convertChartsToImages } from "@/lib/chat-export";
import { renderMarkdownToHtml } from "@/lib/clipboard-utils";
import { ConfirmDialog } from "./ConfirmDialog";
import Link from "next/link";
import mermaid from "mermaid";
import { CodeBlock } from "./CodeBlock";
import { ChatInput } from "./ChatInput";

interface Message {
    id: string;
    role: "user" | "model";
    content: string;
}

interface ProfileChatInterfaceProps {
    profile: GitHubProfile;
    profileReadme: string | null;
    repoReadmes: { repo: string; content: string; updated_at: string; description: string | null; stars: number; forks: number }[];
}

// Initialize mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict', // Prevent XSS attacks by enabling HTML sanitization
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

import { Mermaid } from "./Mermaid";

import { repairMarkdown } from "@/lib/markdown-utils";

// Extract MessageContent to a memoized component
const MessageContent = ({ content, messageId }: { content: string, messageId: string }) => {
    const repairedContent = useMemo(() => repairMarkdown(content), [content]);

    // Use a ref to allow recursive reference to components
    const componentsRef = useRef<any>(null);

    const components = useMemo(() => {
        const comps = {
            code: ({ className, children, ...props }: any) => {
                const match = /language-(\w+)/.exec(className || "");
                const isMermaid = match && match[1] === "mermaid";
                const isMermaidJson = match && match[1] === "mermaid-json";

                if (isMermaid) {
                    return <Mermaid key={messageId} chart={String(children).replace(/\n$/, "")} />;
                }

                if (isMermaidJson) {
                    try {
                        const jsonContent = String(children).replace(/\n$/, "");
                        const data = JSON.parse(jsonContent);
                        const chart = generateMermaidFromJSON(data);
                        return <Mermaid key={messageId} chart={chart} />;
                    } catch (e) {
                        return (
                            <div className="flex items-center gap-2 p-4 bg-zinc-900/50 rounded-lg border border-white/10">
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                <span className="text-zinc-400 text-sm">Generating diagram...</span>
                            </div>
                        );
                    }
                }

                const contentStr = String(children);
                const isBlock = contentStr.endsWith('\n');
                // ProfileChatInterface doesn't have inline prop in destructuring, but we can check if it was passed in props
                // actually we destructured it in ChatInterface but here it was ...props. 
                // Let's destructure it for clarity or just use props.inline
                const inline = (props as any).inline;
                const shouldRenderBlock = match || isBlock || (inline === false);

                return shouldRenderBlock ? (
                    <CodeBlock
                        language={match ? match[1] : "markdown"}
                        value={contentStr.replace(/\n$/, "")}
                        components={componentsRef.current}
                    />
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
        };
        componentsRef.current = comps;
        return comps;
    }, [messageId]);

    return (
        <EnhancedMarkdown
            content={repairedContent}
            components={components}
        />
    );
};

const PROFILE_SUGGESTIONS = [
    "What projects is he/she known for?",
    "What are his/her main skills and expertise?",
    "Summarize his/her most popular repositories",
    "What programming languages does he/she use?",
];

export function ProfileChatInterface({ profile, profileReadme, repoReadmes }: ProfileChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "model",
            content: `Hello! I've analyzed **${profile.login}**'s GitHub profile${profileReadme ? ' and profile README' : ''}${repoReadmes.length > 0 ? `, along with ${repoReadmes.length} repository READMEs` : ''}. Ask me anything about their projects, skills, or contributions!`,
        },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const [initialized, setInitialized] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [selectionText, setSelectionText] = useState("");
    const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);
    const [referenceText, setReferenceText] = useState("");

    // Load conversation on mount
    const toastShownRef = useRef(false);
    useEffect(() => {
        const saved = loadProfileConversation(profile.login);
        if (saved && saved.length > 1) {
            setMessages(saved);
            setShowSuggestions(false);
            if (!toastShownRef.current) {
                toast.info('Conversation restored', { duration: 2000 });
                toastShownRef.current = true;
            }
        }
        setInitialized(true);
    }, [profile.login]);

    // Save on every message change
    useEffect(() => {
        if (initialized && messages.length > 1) {
            saveProfileConversation(profile.login, messages);
        }
    }, [messages, initialized, profile.login]);

    // Calculate total token count
    const totalTokens = useMemo(() => {
        return countMessageTokens(messages.map(m => ({ role: m.role, parts: m.content })));
    }, [messages]);

    const tokenWarningLevel = getTokenWarningLevel(totalTokens);

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
        const trimmedInput = input.trim();
        if ((!trimmedInput && !referenceText) || loading) return;

        // Check token limit
        if (totalTokens >= MAX_TOKENS) {
            toast.error("Conversation limit reached", {
                description: "Please clear the chat to start a new conversation.",
                duration: 5000,
            });
            return;
        }

        setShowSuggestions(false);

        const combinedInput = referenceText
            ? `Reference:\n> ${referenceText.replace(/\n/g, "\n> ")}\n\n${trimmedInput || "Please continue."}`
            : trimmedInput;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: "user",
            content: combinedInput,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setReferenceText("");
        setLoading(true);

        try {
            // Get visitor ID
            let visitorId = localStorage.getItem("visitor_id");
            if (!visitorId) {
                visitorId = crypto.randomUUID();
                localStorage.setItem("visitor_id", visitorId);
            }

            const history = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            const result = await processProfileQuery(combinedInput, {
                username: profile.login,
                profile: profile, // Pass full profile object
                profileReadme,
                repoReadmes,
            }, visitorId, history);

            const modelMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "model",
                content: result.answer,
            };

            setMessages((prev) => [...prev, modelMsg]);
        } catch (error: any) {
            console.error(error);

            // Check if it's a rate limit error
            if (isRateLimitError(error)) {
                toast.error(getRateLimitErrorMessage(error), {
                    description: "Please wait a few moments before trying again.",
                    duration: 5000,
                });
            } else {
                toast.error("Failed to analyze profile", {
                    description: "An unexpected error occurred. Please try again.",
                });
            }

            // Show user-friendly error message
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "model",
                content: "I encountered an error while analyzing the profile. Please try again or rephrase your question.",
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const handleSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            setSelectionAnchor(null);
            setSelectionText("");
            return;
        }

        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        const getModelContainer = (node: Node | null) => {
            const element = node instanceof Element ? node : node?.parentElement;
            return element?.closest('[data-message-role="model"]') || null;
        };

        const startContainer = getModelContainer(anchorNode);
        const endContainer = getModelContainer(focusNode);
        if (!startContainer || startContainer !== endContainer) {
            setSelectionAnchor(null);
            setSelectionText("");
            return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const scrollContainer = chatScrollRef.current;
        if (!scrollContainer) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const x = rect.left - containerRect.left + rect.width / 2;
        const y = rect.top - containerRect.top + scrollContainer.scrollTop;
        const text = selection.toString().trim();

        if (!text) {
            setSelectionAnchor(null);
            setSelectionText("");
            return;
        }

        setSelectionAnchor({ x, y });
        setSelectionText(text);
    };

    const handleAskFromSelection = () => {
        if (!selectionText) return;
        setReferenceText(selectionText);
        setSelectionAnchor(null);
        setSelectionText("");
        setInput((current) => current);
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
    };

    const clearReference = () => {
        setReferenceText("");
    };

    const handleClearChat = () => {
        clearProfileConversation(profile.login);
        setMessages([
            {
                id: "welcome",
                role: "model",
                content: `Hello! I've analyzed **${profile.login}**'s GitHub profile${profileReadme ? ' and profile README' : ''}${repoReadmes.length > 0 ? `, along with ${repoReadmes.length} repository READMEs` : ''}. Ask me anything about their projects, skills, or contributions!`,
            },
        ]);
        setShowSuggestions(true);
        toast.success("Chat history cleared");
    };

    const handleCopyMessage = async (message: Message) => {
        try {
            // Convert mermaid blocks to inline SVG data URIs before clipboard copy.
            const markdown = await convertChartsToImages(message.content, {
                renderMermaid: (code, id) => mermaid.render(id, code).then((out) => out.svg),
                convertMermaidJson: (json) => {
                    try {
                        return generateMermaidFromJSON(JSON.parse(json));
                    } catch {
                        return null;
                    }
                },
            });
            // Render markdown to static HTML for rich clipboard paste into docs.
            const html = renderMarkdownToHtml(markdown);
            if ("ClipboardItem" in window && navigator.clipboard.write) {
                try {
                    // Prefer HTML + plain text for best compatibility.
                    const item = new ClipboardItem({
                        "text/html": new Blob([html], { type: "text/html" }),
                        "text/plain": new Blob([markdown], { type: "text/plain" }),
                    });
                    await navigator.clipboard.write([item]);
                } catch {
                    try {
                        // Fallback to markdown + plain text if HTML write is blocked.
                        const item = new ClipboardItem({
                            "text/markdown": new Blob([markdown], { type: "text/markdown" }),
                            "text/plain": new Blob([markdown], { type: "text/plain" }),
                        });
                        await navigator.clipboard.write([item]);
                    } catch {
                        // Final fallback for browsers that only allow writeText.
                        await navigator.clipboard.writeText(markdown);
                    }
                }
            } else {
                await navigator.clipboard.writeText(markdown);
            }
            setCopiedMessageId(message.id);
            setTimeout(() => {
                setCopiedMessageId((current) => (current === message.id ? null : current));
            }, 1500);
            toast.success("Response copied");
        } catch {
            toast.error("Failed to copy response");
        }
    };

    const handleExportChat = async () => {
        const contextLabel = profile.login;
        await exportChatToMarkdownFile({
            title: `${contextLabel} Chat Export`,
            contextLabel,
            messages,
            renderMermaid: (code, id) => mermaid.render(id, code).then((out) => out.svg),
            convertMermaidJson: (json) => {
                try {
                    return generateMermaidFromJSON(JSON.parse(json));
                } catch {
                    return null;
                }
            },
        });
        toast.success("Chat exported");
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-black text-white">
            {/* Profile Header */}
            <div className="border-b border-white/10 p-6 bg-zinc-900/50 backdrop-blur-sm">
                <div className="flex items-start gap-6 max-w-3xl mx-auto">
                    <Link
                        href="/"
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Back to home"
                    >
                        <ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" />
                    </Link>
                    <img
                        src={profile.avatar_url}
                        alt={profile.login}
                        className="w-10 h-10 md:w-20 md:h-20 rounded-xl border-2 border-white/20"
                    />
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-lg md:text-2xl font-bold truncate max-w-[200px] md:max-w-md">{profile.name || profile.login}</h1>
                            <a
                                href={profile.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-zinc-400 hover:text-white transition-colors"
                            >
                                <Github className="w-5 h-5" />
                            </a>

                            {/* Token Count Display */}
                            <div className={cn(
                                "ml-auto hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                                tokenWarningLevel === 'danger' && "bg-red-500/10 text-red-400 border border-red-500/20",
                                tokenWarningLevel === 'warning' && "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
                                tokenWarningLevel === 'safe' && "bg-zinc-800 text-zinc-400 border border-white/10"
                            )}>
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span>{formatTokenCount(totalTokens)} / {formatTokenCount(MAX_TOKENS)} tokens</span>
                            </div>

                            <button
                                onClick={handleExportChat}
                                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                                title="Export Chat"
                            >
                                <Download className="w-5 h-5" />
                            </button>

                            <button
                                onClick={() => setShowClearConfirm(true)}
                                className="hidden md:block p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                                title="Clear Chat"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>

                            <button
                                onClick={() => setShowClearConfirm(true)}
                                className="md:hidden ml-auto p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                                title="Clear Chat"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                        {profile.bio && (
                            <p className="text-zinc-400 mb-3 line-clamp-2 hidden md:block">{profile.bio}</p>
                        )}
                        <div className="flex w-full justify-between md:justify-start md:gap-4 text-sm text-zinc-500">
                            <span className="flex items-center gap-1">
                                <BookMarked className="w-4 h-4" />
                                {profile.public_repos} repos
                            </span>
                            <span className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                {profile.followers} followers
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div
                ref={chatScrollRef}
                onMouseUp={handleSelection}
                className="flex-1 overflow-y-auto p-4 space-y-6 relative"
            >
                {selectionAnchor && (
                    <button
                        onClick={handleAskFromSelection}
                        className="absolute z-20 -translate-y-full -mt-2 px-3 py-1 bg-white text-black text-xs rounded-full shadow-lg border border-black/10 transition-transform transition-shadow duration-150 ease-out hover:-translate-y-[110%] hover:scale-105 hover:shadow-xl"
                        style={{ left: selectionAnchor.x, top: selectionAnchor.y }}
                    >
                        Ask RepoMindAI
                    </button>
                )}
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
                                "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg overflow-hidden",
                                msg.role === "model"
                                    ? "bg-gradient-to-br from-purple-600 to-blue-600"
                                    : "bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10"
                            )}>
                                {msg.role === "model" ? (
                                    <BotIcon className="w-full h-full text-white" />
                                ) : (
                                    <UserIcon className="w-full h-full text-white" />
                                )}
                            </div>

                            <div className={cn(
                                "flex flex-col gap-2",
                                msg.role === "user" ? "items-end max-w-[80%]" : "items-start w-full min-w-0"
                            )}>
                                <div className={cn(
                                    "relative p-4 rounded-2xl overflow-hidden min-w-0",
                                    msg.role === "user"
                                        ? "bg-blue-600 text-white rounded-tr-none"
                                        : "bg-zinc-900 border border-white/10 rounded-tl-none"
                                )}
                                data-message-role={msg.role}
                                >
                                    {msg.role === "model" && (
                                        <button
                                            onClick={() => handleCopyMessage(msg)}
                                            className="absolute top-2 right-2 p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                                            title="Copy response"
                                        >
                                            <CopySquaresIcon
                                                className={cn(
                                                    "w-4 h-4",
                                                    copiedMessageId === msg.id && "text-emerald-400"
                                                )}
                                            />
                                        </button>
                                    )}
                                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words overflow-hidden w-full min-w-0">
                                        <MessageContent content={msg.content} messageId={msg.id} />
                                    </div>
                                </div>
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
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shrink-0 shadow-lg animate-pulse overflow-hidden">
                            <BotIcon className="w-full h-full text-white opacity-80" />
                        </div>
                        <div className="bg-zinc-900 border border-white/10 p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span className="text-zinc-400 text-sm">Analyzing profile...</span>
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-white/10 bg-black/50 backdrop-blur-lg space-y-3">
                {referenceText && (
                    <div className="max-w-3xl mx-auto">
                        <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-300">
                            <span className="text-zinc-400">Ask RepoMindAI</span>
                            <span className="truncate">{referenceText}</span>
                            <button
                                onClick={clearReference}
                                className="ml-auto p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded"
                                title="Clear reference"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
                {/* Suggestions */}
                {showSuggestions && messages.length === 1 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-3xl mx-auto"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-purple-400" />
                            <span className="text-sm text-zinc-400">Suggested questions:</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {PROFILE_SUGGESTIONS.map((suggestion, index) => (
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
                    <ChatInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleSubmit}
                        placeholder={totalTokens >= MAX_TOKENS ? "Conversation limit reached. Please clear chat." : "Ask about their projects, skills, or contributions..."}
                        disabled={totalTokens >= MAX_TOKENS}
                        loading={loading}
                        allowEmptySubmit={Boolean(referenceText)}
                    />
                </form>
            </div>

            <ConfirmDialog
                isOpen={showClearConfirm}
                title="Clear Chat History?"
                message="This will permanently delete all messages in this conversation. This action cannot be undone."
                confirmText="Clear Chat"
                cancelText="Cancel"
                confirmVariant="danger"
                onConfirm={handleClearChat}
                onCancel={() => setShowClearConfirm(false)}
            />
        </div >
    );
}
