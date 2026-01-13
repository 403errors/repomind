import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, FileCode, ChevronRight, ArrowLeft, Sparkles, Github, Menu, MessageCircle, Shield, AlertTriangle, Download, CheckCircle, Info, Trash2, X } from "lucide-react";
import { BotIcon } from "@/components/icons/BotIcon";
import { UserIcon } from "@/components/icons/UserIcon";
import { CopySquaresIcon } from "@/components/icons/CopySquaresIcon";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { analyzeRepoFiles, fetchRepoFiles, generateAnswer, scanRepositoryVulnerabilities, fetchProfile } from "@/app/actions";
import { cn } from "@/lib/utils";
import mermaid from "mermaid";
import html2canvas from "html2canvas-pro";
import { EnhancedMarkdown } from "./EnhancedMarkdown";
import { countMessageTokens, formatTokenCount, getTokenWarningLevel, isRateLimitError, getRateLimitErrorMessage, MAX_TOKENS } from "@/lib/tokens";
import { validateMermaidSyntax, sanitizeMermaidCode, getFallbackTemplate, generateMermaidFromJSON } from "@/lib/diagram-utils";
import { saveConversation, loadConversation, clearConversation } from "@/lib/storage";
import { exportChatToMarkdownFile, convertChartsToImages } from "@/lib/chat-export";
import { renderMarkdownToHtml } from "@/lib/clipboard-utils";
import { DevTools } from "./DevTools";
import { ConfirmDialog } from "./ConfirmDialog";
import { CodeBlock } from "./CodeBlock";
import { ChatInput } from "./ChatInput";
import Link from "next/link";
import { StreamingProgress } from "./StreamingProgress";
import type { StreamUpdate } from "@/lib/streaming-types";

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

// ... (imports remain the same, remove local Mermaid definition)

import { repairMarkdown } from "@/lib/markdown-utils";

// ... (imports)

// Extract MessageContent to a memoized component
const MessageContent = ({ content, messageId }: { content: string, messageId: string }) => {
    const repairedContent = useMemo(() => repairMarkdown(content), [content]);

    // Use a ref to allow recursive reference to components
    const componentsRef = useRef<any>(null);

    const components = useMemo(() => {
        const comps = {
            code: ({ className, children, inline, ...props }: any) => {
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
            p: ({ children }: any) => <div className="mb-4 leading-relaxed last:mb-0">{children}</div>,
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

// ... (rest of the file)

// In the render loop:
// <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words overflow-hidden w-full min-w-0">
//     <MessageContent content={msg.content} messageId={msg.id} />
// </div>

const REPO_SUGGESTIONS = [
    "Show me the user flow chart",
    "Find security vulnerabilities",
    "Evaluate code quality",
    "What's the tech stack?",
    "Explain the architecture",
];

interface Vulnerability {
    title: string;
    severity: string;
    description: string;
    file: string;
    line?: number;
    recommendation: string;
}

interface Message {
    id: string;
    role: "user" | "model";
    content: string;
    relevantFiles?: string[];
    tokenCount?: number;
    vulnerabilities?: Vulnerability[];
}

interface ChatInterfaceProps {
    repoContext: { owner: string; repo: string; fileTree: any[] };
    onToggleSidebar?: () => void;
}

export function ChatInterface({ repoContext, onToggleSidebar }: ChatInterfaceProps) {
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
    const [scanning, setScanning] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const [initialized, setInitialized] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [selectionText, setSelectionText] = useState("");
    const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null);
    const [referenceText, setReferenceText] = useState("");

    // Streaming state
    const [streamingStatus, setStreamingStatus] = useState<{ message: string; progress: number } | null>(null);
    const [currentStreamingMessage, setCurrentStreamingMessage] = useState("");
    const [ownerProfile, setOwnerProfile] = useState<any>(null);

    // Fetch owner profile on mount
    useEffect(() => {
        const loadProfile = async () => {
            try {
                const profile = await fetchProfile(repoContext.owner);
                setOwnerProfile(profile);
            } catch (e) {
                console.error("Failed to load owner profile:", e);
            }
        };
        loadProfile();
    }, [repoContext.owner]);

    // Load conversation on mount
    const toastShownRef = useRef(false);
    useEffect(() => {
        const saved = loadConversation(repoContext.owner, repoContext.repo);
        if (saved && saved.length > 1) {
            setMessages(saved);
            setShowSuggestions(false);
            if (!toastShownRef.current) {
                toast.info('Conversation restored', { duration: 2000 });
                toastShownRef.current = true;
            }
        }
        setInitialized(true);
    }, [repoContext.owner, repoContext.repo]);

    // Save on every message change
    useEffect(() => {
        if (initialized && messages.length > 1) {
            saveConversation(repoContext.owner, repoContext.repo, messages);
        }
    }, [messages, initialized, repoContext.owner, repoContext.repo]);

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

        // Handle special commands
        if (input.toLowerCase().includes("find security vulnerabilities") || input.toLowerCase().includes("scan for vulnerabilities")) {
            console.log('🎯 Security scan triggered!');
            setScanning(true);
            try {
                // Step 1: Start scan
                setStreamingStatus({ message: "Preparing security scan...", progress: 10 });

                const filesToScan = repoContext.fileTree.map((f: any) => ({ path: f.path, sha: f.sha }));
                console.log('📋 Total files in tree:', filesToScan.length);

                // Step 2: Show file count
                const codeFileCount = filesToScan.filter((f: any) =>
                    /\.(js|jsx|ts|tsx|py|java|php|rb|go|rs)$/i.test(f.path) || f.path === 'package.json'
                ).length;
                console.log('💻 Code files found:', codeFileCount);
                setStreamingStatus({ message: `Scanning ${Math.min(codeFileCount, 20)} code files...`, progress: 30 });

                // Step 3: Run scan
                setStreamingStatus({ message: "Running pattern-based analysis...", progress: 50 });
                console.log('🚀 Calling scanRepositoryVulnerabilities...');

                const { findings, summary } = await scanRepositoryVulnerabilities(
                    repoContext.owner,
                    repoContext.repo,
                    filesToScan
                );

                console.log('✅ Scan complete! Findings:', findings.length, 'Summary:', summary);
                console.log('📊 Debug Info:', summary.debug);

                // Step 4: Finalizing
                setStreamingStatus({ message: "Analyzing results...", progress: 90 });



                let content = '';

                if (summary.total === 0) {
                    // No vulnerabilities found
                    const filesScanned = summary.debug?.filesSuccessfullyFetched || 0;
                    content = `✅ **Security scan complete!**\n\nI've scanned **${filesScanned} files** and found **no security vulnerabilities**.\n\nYour code looks secure! The scan checked for:\n- SQL injection vulnerabilities\n- Cross-site scripting (XSS)\n- Unsafe child_process usage\n- Hardcoded secrets\n- Weak cryptographic algorithms\n- Command injection\n\nKeep up the good security practices! 🔒`;
                } else {
                    // Vulnerabilities found
                    const filesScanned = summary.debug?.filesSuccessfullyFetched || 0;
                    content = `⚠️ **Security scan complete!**\n\nI've scanned **${filesScanned} files** and found **${summary.total} potential issue${summary.total !== 1 ? 's' : ''}**.\n\n`;

                    if (summary.critical > 0) content += `🔴 **${summary.critical} Critical**\n`;
                    if (summary.high > 0) content += `🟠 **${summary.high} High**\n`;
                    if (summary.medium > 0) content += `🟡 **${summary.medium} Medium**\n`;
                    if (summary.low > 0) content += `🔵 **${summary.low} Low**\n`;

                    content += `\nHere are the key findings:\n\n`;

                    findings.slice(0, 5).forEach(f => {
                        content += `### ${f.title}\n`;
                        content += `**Severity**: ${f.severity.toUpperCase()}\n`;
                        content += `**File**: \`${f.file}\` ${f.line ? `(Line ${f.line})` : ''}\n`;
                        content += `**Issue**: ${f.description}\n`;
                        content += `**Fix**: ${f.recommendation}\n\n`;
                    });

                    if (findings.length > 5) {
                        content += `*...and ${findings.length - 5} more issue${findings.length - 5 !== 1 ? 's' : ''}.*`;
                    }
                }


                const modelMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: content,
                    vulnerabilities: findings as any
                };
                setMessages((prev) => [...prev, modelMsg]);
                setStreamingStatus(null); // Clear streaming status
                setLoading(false);
                setScanning(false);
                return;
            } catch (error) {
                console.error("Scan failed:", error);
                toast.error("Security scan failed", {
                    description: error instanceof Error ? error.message : "An error occurred during scanning"
                });
                setStreamingStatus(null); // Clear streaming status
                setScanning(false);
                setLoading(false);

                // Show error message to user
                const errorMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: "I encountered an error while scanning for security vulnerabilities. Please try again.",
                };
                setMessages((prev) => [...prev, errorMsg]);
                return; // Don't fall through to normal chat
            }
        }

        try {
            const filePaths = repoContext.fileTree.map((f: any) => f.path);

            // Step 1: Analyze files
            setStreamingStatus({ message: "Selecting relevant files...", progress: 10 });
            const { relevantFiles, fileCount } = await analyzeRepoFiles(input, filePaths, repoContext.owner, repoContext.repo);

            // Step 2: Fetch files  
            setStreamingStatus({ message: `Fetching ${fileCount} file${fileCount !== 1 ? 's' : ''} from GitHub...`, progress: 40 });

            const filesToFetch = relevantFiles.map(path => {
                const node = repoContext.fileTree.find((f: any) => f.path === path);
                return { path, sha: node?.sha || "" };
            });

            const { context } = await fetchRepoFiles(repoContext.owner, repoContext.repo, filesToFetch);

            // Step 3: Generate response
            setStreamingStatus({ message: "Generating response...", progress: 70 });
            // Get visitor ID
            let visitorId = localStorage.getItem("visitor_id");
            if (!visitorId) {
                visitorId = crypto.randomUUID();
                localStorage.setItem("visitor_id", visitorId);
            }

            const answer = await generateAnswer(
                combinedInput,
                context,
                { owner: repoContext.owner, repo: repoContext.repo },
                messages.map(m => ({ role: m.role, content: m.content })),
                ownerProfile, // Pass profile data for developer cards
                visitorId
            );

            const modelMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "model",
                content: answer,
                relevantFiles,
            };

            setMessages((prev) => [...prev, modelMsg]);
            setStreamingStatus(null);
        } catch (error: any) {
            console.error(error);

            // Check if it's a rate limit error
            if (isRateLimitError(error)) {
                toast.error(getRateLimitErrorMessage(error), {
                    description: "Please wait a few moments before trying again.",
                    duration: 5000,
                });
            } else {
                toast.error("Failed to analyze code", {
                    description: "An unexpected error occurred. Please try again.",
                });
            }

            // Show user-friendly error message
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "model",
                content: "I encountered an error while analyzing the code. Please try again or rephrase your question.",
            };
            setMessages((prev) => [...prev, errorMsg]);
            setStreamingStatus(null);
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
        clearConversation(repoContext.owner, repoContext.repo);
        setMessages([
            {
                id: "welcome",
                role: "model",
                content: `Hello! I've analyzed **${repoContext.owner}/${repoContext.repo}**. Ask me anything about the code structure, dependencies, or specific features.`,
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
        const contextLabel = `${repoContext.owner}/${repoContext.repo}`;
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
        <div className="flex flex-col h-full bg-black text-white">
            {/* Repo Header */}
            <div className="border-b border-white/10 p-4 bg-zinc-900/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 max-w-3xl mx-auto">
                    {onToggleSidebar && (
                        <button
                            onClick={onToggleSidebar}
                            className="md:hidden p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <Menu className="w-5 h-5 text-zinc-400" />
                        </button>
                    )}
                    <Link
                        href="/"
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Back to home"
                    >
                        <ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" />
                    </Link>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Github className="w-5 h-5 text-zinc-400 shrink-0" />
                        <h1 className="text-lg font-semibold text-zinc-100 truncate">{repoContext.owner}/{repoContext.repo}</h1>
                    </div>

                    <div className={cn(
                        "ml-auto hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        tokenWarningLevel === 'danger' && "bg-red-500/10 text-red-400 border border-red-500/20",
                        tokenWarningLevel === 'warning' && "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
                        tokenWarningLevel === 'safe' && "bg-zinc-800 text-zinc-400 border border-white/10"
                    )}>
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>{formatTokenCount(totalTokens)} / {formatTokenCount(MAX_TOKENS)} tokens</span>
                    </div>

                    <div className="hidden md:block">
                        <DevTools
                            repoContext={repoContext}
                            onSendMessage={(role, content) => {
                                setMessages(prev => [...prev, {
                                    id: Date.now().toString(),
                                    role,
                                    content
                                }]);
                            }}
                        />
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
                        className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Clear Chat"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>


                </div>
            </div>

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
                                "w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                            )}>
                                {msg.role === "model" ? (
                                    <BotIcon className="w-full h-full text-white" />
                                ) : (
                                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                                        <UserIcon className="w-full h-full text-zinc-400" />
                                    </div>
                                )}
                            </div>

                            <div className={cn(
                                "flex flex-col gap-2",
                                msg.role === "user" ? "items-end max-w-[85%] md:max-w-[80%]" : "items-start max-w-full md:max-w-full w-full min-w-0"
                            )}>
                                <div className={cn(
                                    "relative p-4 rounded-2xl overflow-hidden w-full min-w-0",
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

                {(loading || streamingStatus) && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-4 max-w-3xl mx-auto"
                    >
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 animate-pulse overflow-hidden">
                            <BotIcon className="w-full h-full text-white opacity-80" />
                        </div>
                        <div className="bg-zinc-900 border border-white/10 p-4 rounded-2xl rounded-tl-none flex-1">
                            {streamingStatus ? (
                                <StreamingProgress
                                    message={streamingStatus.message}
                                    progress={streamingStatus.progress}
                                />
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                    <span className="text-zinc-400 text-sm">Analyzing code...</span>
                                </div>
                            )}

                            {/* Show streaming content if available */}
                            {currentStreamingMessage && (
                                <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words overflow-hidden w-full min-w-0 mt-4 border-t border-white/10 pt-4">
                                    <MessageContent content={currentStreamingMessage} messageId="streaming" />
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

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
                    <ChatInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleSubmit}
                        placeholder={totalTokens >= MAX_TOKENS ? "Conversation limit reached. Please clear chat." : "Ask a question about the code..."}
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
        </div>
    );
}
