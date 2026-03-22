import { useState, useRef, useEffect, useMemo } from "react";
import { Github, Users, BookMarked, ArrowLeft, Sparkles, MessageCircle, Trash2, Download, X } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

import { BotIcon } from "@/components/icons/BotIcon";
import { UserAvatar } from "./UserAvatar";
import { CopySquaresIcon } from "@/components/icons/CopySquaresIcon";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { GitHubProfile } from "@/lib/github";
import { countMessageTokens, formatTokenCount, getTokenWarningLevel, isRateLimitError, getRateLimitErrorMessage, MAX_TOKENS } from "@/lib/tokens";
import { COPY_FEEDBACK_MS } from "@/lib/chat-constants";
import { copyChatMessageContent, exportChatMessages } from "@/lib/chat-message-actions";
import { parseStreamChunk } from "@/lib/streaming-parser";
import { saveProfileConversation, loadProfileConversation, clearProfileConversation } from "@/lib/storage";
import type { ModelPreference } from "@/lib/ai-client";
import type { ProfileChatMessage } from "@/lib/chat-types";

import { ConfirmDialog } from "./ConfirmDialog";
import { LoginModal } from "./LoginModal";
import { ChatInput } from "./ChatInput";
import { ReasoningBlock } from "./ReasoningBlock";
import { MessageContent } from "./chat/MessageContent";
import { useMessageSelection } from "./chat/useMessageSelection";
import { StreamStatus } from "./chat/StreamStatus";

interface ProfileChatInterfaceProps {
    profile: GitHubProfile;
    profileReadme: string | null;
    repoReadmes: { repo: string; content: string; updated_at: string; description: string | null; stars: number; forks: number; language: string | null }[];
    recentCommits: { repo: string; message: string; date: string | null; sha: string }[];
    recentCommitFreshnessLabel: string;
}

const PROFILE_SUGGESTIONS = [
    "What projects is he/she known for?",
    "What are his/her main skills and expertise?",
    "Summarize his/her most popular repositories",
    "What programming languages does he/she use?",
];

type HttpError = Error & { status?: number; code?: string };
type ChatRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

function areProfileMessagesEquivalent(left: ProfileChatMessage[], right: ProfileChatMessage[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((message, index) => {
        const next = right[index];
        if (!next) return false;
        return (
            message.id === next.id &&
            message.role === next.role &&
            message.content === next.content
        );
    });
}

function parseResponseError(rawResponseText: string, status: number): { message: string; code?: string } {
    if (!rawResponseText.trim()) {
        return { message: `Failed to start analysis stream (HTTP ${status}).` };
    }

    try {
        const parsed = JSON.parse(rawResponseText) as { error?: unknown; code?: unknown };
        if (typeof parsed.error === "string" && parsed.error.trim()) {
            return {
                message: parsed.error,
                code: typeof parsed.code === "string" ? parsed.code : undefined,
            };
        }
    } catch {
        // Ignore parse failure and fall back to raw response text.
    }

    return { message: rawResponseText.trim() };
}

function getErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;
    const maybeStatus = (error as { status?: unknown }).status;
    return typeof maybeStatus === "number" ? maybeStatus : undefined;
}

function getUserFacingAnalysisError(error: unknown, code?: string): string {
    if (code === "AI_FUNCTION_TURN_ORDER" || code === "AI_MISSING_THOUGHT_SIGNATURE") {
        return "AI tool handoff failed during streaming. Please retry.";
    }

    const raw = error instanceof Error ? error.message : "";
    const cleaned = raw.replace(/^\[GoogleGenerativeAI Error\]:\s*/i, "").trim();

    if (!cleaned) {
        return "An unexpected error occurred while analyzing the profile.";
    }

    if (/function response turn comes immediately after a function call turn/i.test(cleaned)) {
        return "AI tool handoff failed during streaming. Please retry.";
    }

    if (/missing a thought_signature|thought_signature/i.test(cleaned)) {
        return "AI tool handoff failed during streaming. Please retry.";
    }

    return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

function normalizeStreamingLabel(message: string): string {
    return message.replace(/[ \t]*(?:\.{3}|…)+\s*$/g, "").trim();
}

function formatToolStatusLabel(name: string, detail?: string): string {
    if (name === "googleSearch") {
        return detail ? `Searching Google for ${detail}` : "Searching Google";
    }

    if (detail) {
        if (detail.startsWith(`${name}(`)) {
            return `Calling ${detail}`;
        }
        return `Calling ${name}: ${detail}`;
    }

    return `Calling ${name}`;
}

export function ProfileChatInterface({
    profile,
    profileReadme,
    repoReadmes,
    recentCommits,
    recentCommitFreshnessLabel,
}: ProfileChatInterfaceProps) {
    const { data: session, status: sessionStatus } = useSession();
    const shouldUseCloudStorage = sessionStatus !== "unauthenticated";
    const [messages, setMessages] = useState<ProfileChatMessage[]>([
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
    const {
        selectionAnchor,
        referenceText,
        handleSelection,
        handleAskFromSelection,
        clearReference,
    } = useMessageSelection(chatScrollRef);

    const [initialized, setInitialized] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [modelPreference, setModelPreference] = useState<ModelPreference>("flash");
    const [crossRepoEnabled, setCrossRepoEnabled] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginModalCopy, setLoginModalCopy] = useState<{ title?: string; description?: string }>({});
    const [connectionLost, setConnectionLost] = useState(false);
    const isSubmittingRef = useRef(false);
    const activeRunKey = useMemo(() => `repomind:chatRun:profile:${profile.login}`, [profile.login]);

    useEffect(() => {
        if (!session && crossRepoEnabled) {
            setCrossRepoEnabled(false);
        }
    }, [session, crossRepoEnabled]);

    // Load conversation on mount
    const restoreGenerationRef = useRef(0);
    const skipNextAutoScrollRef = useRef(false);
    useEffect(() => {
        const restoreGeneration = restoreGenerationRef.current;
        const fetchConversation = async () => {
            const saved = await loadProfileConversation(profile.login, shouldUseCloudStorage);
            if (restoreGeneration !== restoreGenerationRef.current) {
                return;
            }
            if (saved && saved.length > 1) {
                setMessages((prev) => {
                    if (areProfileMessagesEquivalent(prev, saved)) {
                        return prev;
                    }
                    skipNextAutoScrollRef.current = true;
                    return saved;
                });
                setShowSuggestions(false);
            }
            setInitialized(true);

            const storedRunId = typeof window !== "undefined" ? window.sessionStorage.getItem(activeRunKey) : null;
            if (storedRunId) {
                try {
                    const runRes = await fetch(`/api/chat/run?runId=${encodeURIComponent(storedRunId)}`);
                    if (runRes.ok) {
                        const run = await runRes.json() as {
                            runId: string;
                            status: ChatRunStatus;
                            partialText?: string;
                            finalText?: string | null;
                            errorMessage?: string | null;
                        };
                        if (restoreGeneration !== restoreGenerationRef.current) {
                            return;
                        }
                        const resumeMsgId = `run-${run.runId}`;
                        const text = (run.finalText ?? run.partialText ?? "").toString();
                        if (text) {
                            setMessages((prev) => {
                                const has = prev.some((m) => m.id === resumeMsgId);
                                if (has) {
                                    return prev.map((m) => (m.id === resumeMsgId ? { ...m, role: "model", content: text } : m));
                                }
                                return [...prev, { id: resumeMsgId, role: "model", content: text }];
                            });
                            setShowSuggestions(false);
                        }

                        if (run.status === "RUNNING") {
                            setLoading(true);
                            setConnectionLost(true);
                            const poll = async () => {
                                try {
                                    const r = await fetch(`/api/chat/run?runId=${encodeURIComponent(storedRunId)}`);
                                    if (!r.ok) return;
                                    const next = await r.json() as { status: ChatRunStatus; partialText?: string; finalText?: string | null; errorMessage?: string | null };
                                    if (restoreGeneration !== restoreGenerationRef.current) {
                                        return;
                                    }
                                    const nextText = (next.finalText ?? next.partialText ?? "").toString();
                                    setMessages((prev) => prev.map((m) => (m.id === resumeMsgId ? { ...m, content: nextText } : m)));
                                    if (next.status === "COMPLETED") {
                                        setLoading(false);
                                        setConnectionLost(false);
                                        window.sessionStorage.removeItem(activeRunKey);
                                    } else if (next.status === "FAILED") {
                                        setLoading(false);
                                        setConnectionLost(false);
                                        window.sessionStorage.removeItem(activeRunKey);
                                    } else {
                                        setTimeout(poll, 1000);
                                    }
                                } catch {
                                    setTimeout(poll, 1500);
                                }
                            };
                            setTimeout(poll, 600);
                        } else if (run.status === "COMPLETED" || run.status === "FAILED") {
                            window.sessionStorage.removeItem(activeRunKey);
                        }
                    }
                } catch {
                    // Ignore resume failures.
                }
            }
        };
        fetchConversation();
    }, [profile.login, shouldUseCloudStorage, activeRunKey]);

    // Save on every message change
    useEffect(() => {
        if (initialized && messages.length > 1) {
            void saveProfileConversation(profile.login, messages, shouldUseCloudStorage);
        }
    }, [messages, initialized, profile.login, shouldUseCloudStorage]);

    // Calculate total token count
    const totalTokens = useMemo(() => {
        return countMessageTokens(messages.map(m => ({ role: m.role, parts: m.content })));
    }, [messages]);

    const tokenWarningLevel = getTokenWarningLevel(totalTokens);

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    useEffect(() => {
        if (skipNextAutoScrollRef.current) {
            skipNextAutoScrollRef.current = false;
            return;
        }
        scrollToBottom();
    }, [messages]);

    const handleSuggestionClick = (suggestion: string) => {
        setInput(suggestion);
        setShowSuggestions(false);
    };

    const buildCombinedInput = (trimmedInput: string, selectedReferenceText: string) => {
        return selectedReferenceText
            ? `Reference:\n> ${selectedReferenceText.replace(/\n/g, "\n> ")}\n\n${trimmedInput || "Please continue."}`
            : trimmedInput;
    };

    const startProfileStreamMessage = (selectedModelPreference: ModelPreference) => {
        const modelMsgId = (Date.now() + 1).toString();
        setMessages((prev) => [
            ...prev,
            {
                id: modelMsgId,
                role: "model",
                content: "",
                reasoningSteps: [],
                modelUsed: selectedModelPreference,
                streamStatus: "Preparing profile analysis",
                streamProgress: 5,
            },
        ]);
        return modelMsgId;
    };

    const runProfileStreamingFlow = async (modelMsgId: string, combinedInput: string) => {
        const isThinkingStream = modelPreference === "thinking";
        const historyForServer = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }));
        setConnectionLost(false);

        const clientRequestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const runCreateRes = await fetch("/api/chat/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scope: "profile",
                username: profile.login,
                clientRequestId,
            }),
        });
        let runId: string | null = null;
        if (runCreateRes.ok) {
            const run = await runCreateRes.json() as { runId?: string };
            runId = typeof run.runId === "string" ? run.runId : null;
        }
        if (runId) {
            window.sessionStorage.setItem(activeRunKey, runId);
        }

        const response = await fetch("/api/chat/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: combinedInput,
                profileContext: {
                    username: profile.login,
                    profile,
                    profileReadme,
                    repoReadmes,
                    recentCommits,
                    recentCommitFreshnessLabel,
                },
                history: historyForServer,
                modelPreference,
                crossRepoEnabled,
                runId,
            }),
        });

        if (!response.ok || !response.body) {
            const rawResponseText = await response.text().catch(() => "");
            const parsedError = parseResponseError(rawResponseText, response.status);
            const httpError = new Error(parsedError.message) as HttpError;
            httpError.status = response.status;
            httpError.code = parsedError.code;
            httpError.message = parsedError.message;

            console.error("Profile chat stream initialization failed", {
                username: profile.login,
                status: response.status,
                statusText: response.statusText,
                historyMessageCount: historyForServer.length,
                queryPreview: combinedInput.slice(0, 160),
                errorMessage: parsedError.message,
                errorCode: parsedError.code,
            });

            throw httpError;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const accumulatedReasoning: string[] = [];
        let contentText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const parsedChunk = parseStreamChunk(buffer, decoder.decode(value, { stream: true }));
            buffer = parsedChunk.buffer;

            for (const invalidLine of parsedChunk.invalidLines) {
                console.warn("Stream parse error:", invalidLine);
            }

            for (const chunk of parsedChunk.updates) {
                if (chunk.type === "status") {
                    const normalizedStatus = normalizeStreamingLabel(chunk.message);
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId
                            ? {
                                ...message,
                                reasoningSteps: isThinkingStream ? [...(accumulatedReasoning.concat(normalizedStatus))] : message.reasoningSteps,
                                streamStatus: normalizedStatus,
                                streamProgress: chunk.progress,
                            }
                            : message
                    ));
                    if (isThinkingStream) {
                        accumulatedReasoning.push(normalizedStatus);
                    }
                } else if (chunk.type === "tool") {
                    const toolStatus = formatToolStatusLabel(chunk.name, chunk.detail);
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId
                            ? {
                                ...message,
                                reasoningSteps: isThinkingStream ? [...(accumulatedReasoning.concat(`Tool: ${toolStatus}`))] : message.reasoningSteps,
                                streamStatus: toolStatus,
                            }
                            : message
                    ));
                    if (isThinkingStream) {
                        accumulatedReasoning.push(`Tool: ${toolStatus}`);
                    }
                } else if (chunk.type === "thought") {
                    if (!isThinkingStream) {
                        continue;
                    }
                    accumulatedReasoning.push(chunk.text);
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId ? { ...message, reasoningSteps: [...accumulatedReasoning] } : message
                    ));
                } else if (chunk.type === "content") {
                    if (!contentText && chunk.text) {
                        contentText = chunk.text.trimStart();
                    } else {
                        contentText += chunk.text;
                    }
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId ? { ...message, content: contentText } : message
                    ));
                } else if (chunk.type === "error") {
                    const streamError = new Error(chunk.message) as HttpError;
                    streamError.code = chunk.code;
                    throw streamError;
                } else if (chunk.type === "complete") {
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId
                            ? {
                                ...message,
                                commitFreshnessLabel: chunk.metadata?.commitFreshnessLabel,
                                toolsUsed: chunk.metadata?.toolsUsed,
                                processingSummary: chunk.metadata?.processingSummary,
                                sourceScope: chunk.metadata?.sourceScope,
                            }
                            : message
                    ));
                }
            }
        }

        if (buffer.trim()) {
            const finalChunk = parseStreamChunk("", `${buffer}\n`);
            for (const invalidLine of finalChunk.invalidLines) {
                console.warn("Stream parse error:", invalidLine);
            }
            for (const chunk of finalChunk.updates) {
                if (chunk.type === "content") {
                    if (!contentText && chunk.text) {
                        contentText = chunk.text.trimStart();
                    } else {
                        contentText += chunk.text;
                    }
                }
            }
        }

        setMessages((prev) => prev.map((message) =>
            message.id === modelMsgId
                ? { ...message, content: contentText, streamStatus: "Completed", streamProgress: 100 }
                : message
        ));

        if (runId) {
            window.sessionStorage.removeItem(activeRunKey);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;

        const trimmedInput = input.trim();
        if ((!trimmedInput && !referenceText) || loading) {
            isSubmittingRef.current = false;
            return;
        }

        // Check token limit
        if (totalTokens >= MAX_TOKENS) {
            toast.error("Conversation limit reached", {
                description: "Please clear the chat to start a new conversation.",
                duration: 5000,
            });
            isSubmittingRef.current = false;
            return;
        }

        setShowSuggestions(false);

        const combinedInput = buildCombinedInput(trimmedInput, referenceText);

        const userMsg: ProfileChatMessage = {
            id: Date.now().toString(),
            role: "user",
            content: combinedInput,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        clearReference();
        setLoading(true);

        try {
            const modelMsgId = startProfileStreamMessage(modelPreference);
            await runProfileStreamingFlow(modelMsgId, combinedInput);
        } catch (error: unknown) {
            console.error(error);
            const errorStatus = getErrorStatus(error);
            const errorCode = (error as HttpError | undefined)?.code;
            const isAuthError = errorStatus === 401 || errorStatus === 403;
            const isPayloadTooLarge = errorStatus === 413;
            const isAnonUsageLimit = errorCode === "ANON_USAGE_LIMIT_EXCEEDED";
            const isAuthUsageLimit = errorCode === "AUTH_USAGE_LIMIT_EXCEEDED";
            const userFacingError = getUserFacingAnalysisError(error, errorCode);

            if (isAnonUsageLimit) {
                toast.error("Login required for more profile tooling", {
                    description: "Anonymous profile-tool usage limit reached.",
                    duration: 5000,
                });
                setLoginModalCopy({
                    title: "Login To Continue Profile Analysis",
                    description: "Unlock 3x tool budget, cross-repo analysis, Thinking Mode, and faster profile answers.",
                });
                setShowLoginModal(true);
            } else if (isAuthUsageLimit) {
                const limitMessage: ProfileChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: "Usage limit reached for profile chat tools.\n\nPlease contact **pieisnot22by7@gmail.com** for extended limits.",
                };
                setMessages((prev) => [...prev, limitMessage]);
            } else if (isAuthError) {
                toast.error("Sign in required", {
                    description: "Your session has expired or is invalid. Please sign in and try again.",
                    duration: 5000,
                });
                setLoginModalCopy({
                    title: "Sign In Required",
                    description: "Please sign in with GitHub to continue profile analysis features.",
                });
                setShowLoginModal(true);
            } else if (isPayloadTooLarge) {
                toast.error("Request too large", {
                    description: "The profile context is too large. Ask a narrower question and try again.",
                    duration: 5000,
                });
            } else if (isRateLimitError(error)) {
                toast.error(getRateLimitErrorMessage(error), {
                    description: "Please wait a few moments before trying again.",
                    duration: 5000,
                });
            } else {
                toast.error("Failed to analyze profile", {
                    description: userFacingError,
                });
            }

            if (!isAuthError && !isAnonUsageLimit && !isAuthUsageLimit) {
                const errorMsg: ProfileChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: isPayloadTooLarge
                        ? "This request was too large to process. Try a narrower question focused on a specific project or timeframe."
                        : `I encountered an error while analyzing the profile.\n\n${userFacingError}`,
                };
                setMessages((prev) => [...prev, errorMsg]);
            }
        } finally {
            setLoading(false);
            isSubmittingRef.current = false;
            if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(activeRunKey);
            }
        }
    };

    const handleClearChat = async () => {
        restoreGenerationRef.current += 1;
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(activeRunKey);
        }
        await clearProfileConversation(profile.login, shouldUseCloudStorage);
        setLoading(false);
        setConnectionLost(false);
        setInitialized(true);
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

    const handleCopyMessage = async (message: ProfileChatMessage) => {
        try {
            await copyChatMessageContent(message.content);
            setCopiedMessageId(message.id);
            setTimeout(() => {
                setCopiedMessageId((current) => (current === message.id ? null : current));
            }, COPY_FEEDBACK_MS);
            toast.success("Response copied");
        } catch {
            toast.error("Failed to copy response");
        }
    };

    const handleExportChat = async () => {
        const contextLabel = profile.login;
        await exportChatMessages({
            title: `${contextLabel} Chat Export`,
            contextLabel,
            messages,
        });
        toast.success("Chat exported");
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-black text-white">
            {/* Profile Header */}
            <div className="relative z-40 border-b border-white/10 p-4 md:p-6 bg-zinc-950/95">
                <div className="flex items-start gap-3 md:gap-6 max-w-3xl mx-auto">
                    <Link
                        href="/"
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Back to home"
                    >
                        <ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" />
                    </Link>
                    {/* Profile avatars use source URLs from GitHub and remain intentionally unoptimized here. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={profile.avatar_url}
                        alt={profile.login}
                        className="w-10 h-10 md:w-20 md:h-20 rounded-xl border-2 border-white/20"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 mb-2">
                            <h1 className="text-lg md:text-2xl font-bold truncate max-w-[140px] md:max-w-md">{profile.name || profile.login}</h1>
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
                                className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
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
                className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-6 relative isolate z-0 selection:bg-blue-500/50 selection:text-white [&_*::selection]:bg-blue-500/50 [&_*::selection]:text-white"
            >
                {connectionLost && (
                    <div className="max-w-3xl mx-auto">
                        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                            Connection lost. We&apos;ll keep saving the response and reconnect when possible.
                        </div>
                    </div>
                )}
                {selectionAnchor && (
                    <button
                        onClick={handleAskFromSelection}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onMouseUp={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        className="absolute z-20 -translate-y-full -mt-2 px-3 py-1 bg-white text-black text-xs rounded-full shadow-lg border border-black/10 transition-transform transition-shadow duration-150 ease-out hover:-translate-y-[110%] hover:scale-105 hover:shadow-xl"
                        style={{ left: selectionAnchor.x, top: selectionAnchor.y }}
                    >
                        Ask RepoMindAI
                    </button>
                )}
                {messages.map((msg) => {
                        const isLatestMessage = msg.id === messages[messages.length - 1]?.id;
                        return (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex gap-4 max-w-3xl mx-auto",
                                msg.role === "user" ? "flex-row-reverse" : "flex-row"
                            )}
                        >
                            <div className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg overflow-hidden",
                                msg.role === "model"
                                    ? "bg-zinc-950 ring-2 ring-purple-500/60"
                                    : "bg-zinc-800 ring-2 ring-blue-500/50"
                            )}>
                                {msg.role === "model" ? (
                                    <BotIcon className="w-full h-full" />
                                ) : (
                                    <UserAvatar className="w-full h-full" />
                                )}
                            </div>

                            <div className={cn(
                                "flex flex-col gap-2",
                                msg.role === "user" ? "items-end max-w-[80%]" : "items-start w-full min-w-0"
                            )}>
                                {msg.role === "model" && msg.modelUsed !== "thinking" && (
                                    <StreamStatus
                                        message={msg.streamStatus}
                                        isStreaming={loading && isLatestMessage}
                                    />
                                )}
                                {/* ── REASONING: outside bubble, no background ── */}
                                {msg.role === "model" && msg.modelUsed === "thinking" && loading && msg.id === messages[messages.length - 1]?.id && (
                                    <ReasoningBlock
                                        steps={msg.reasoningSteps || []}
                                        isStreaming={true}
                                    />
                                )}
                                {msg.role === "model" && msg.modelUsed === "thinking" && (!loading || msg.id !== messages[messages.length - 1]?.id) && msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
                                    <ReasoningBlock
                                        steps={msg.reasoningSteps}
                                        isStreaming={false}
                                    />
                                )}

                                {/* ── CONTENT BUBBLE: only when content exists OR flash model loading ── */}
                                {(msg.role === "user" || msg.content) && (
                                    <div className={cn(
                                        "relative px-4 py-2.5 rounded-2xl overflow-hidden min-w-0",
                                        msg.role === "user"
                                            ? "bg-blue-600 text-white rounded-tr-none"
                                            : "bg-zinc-900 border border-white/10 rounded-tl-none"
                                    )}
                                        data-message-role={msg.role}
                                    >
                                        {msg.role === "model" && msg.content && !loading && (
                                            <button
                                                onClick={() => handleCopyMessage(msg)}
                                                className="absolute top-2 right-2 p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/10 rounded-md transition-colors"
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
                                        <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words [overflow-wrap:anywhere] overflow-x-hidden w-full min-w-0">
                                            {msg.content && (
                                                <MessageContent
                                                    content={msg.content + (loading && isLatestMessage ? "▋" : "")}
                                                    messageId={msg.id}
                                                    messages={messages}
                                                    currentOwner={profile.login}
                                                    isStreaming={loading && isLatestMessage}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                                {msg.role === "model" && (msg.commitFreshnessLabel || (msg.toolsUsed && msg.toolsUsed.length > 0) || msg.sourceScope || (msg.processingSummary && msg.processingSummary.length > 0)) && (
                                    <div className="hidden md:block text-[11px] text-zinc-500 pl-1">
                                        {msg.sourceScope && <span>Scope: {msg.sourceScope}</span>}
                                        {msg.commitFreshnessLabel && <span>{msg.commitFreshnessLabel}</span>}
                                        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                                            <span className={cn((msg.commitFreshnessLabel || msg.sourceScope) && "ml-2")}>
                                                Tools used: {msg.toolsUsed.join(", ")}
                                            </span>
                                        )}
                                        {msg.processingSummary && msg.processingSummary.length > 0 && (
                                            <span className={cn((msg.commitFreshnessLabel || msg.toolsUsed?.length || msg.sourceScope) && "ml-2")}>
                                                {msg.processingSummary.join(" | ")}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        );
                    })}

                {/* Old loading bubble removed - streaming now happens inline in the last message */}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="relative z-40 p-4 border-t border-white/10 bg-zinc-950/95 space-y-3">
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
                        modelPreference={modelPreference}
                        setModelPreference={setModelPreference}
                        onRequireAuth={() => {
                            setLoginModalCopy({
                                title: "Login Required For Thinking Mode",
                                description: "Sign in to use Thinking Mode, higher limits, and advanced profile tooling.",
                            });
                            setShowLoginModal(true);
                        }}
                        showCrossRepoToggle={true}
                        crossRepoEnabled={crossRepoEnabled}
                        setCrossRepoEnabled={setCrossRepoEnabled}
                        onRequireCrossRepoAuth={() => {
                            setLoginModalCopy({
                                title: "Login Required For Cross-Repo",
                                description: "Cross-repo profile analysis is available for logged-in users with higher tool limits.",
                            });
                            setShowLoginModal(true);
                        }}
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

            <LoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
                title={loginModalCopy.title}
                description={loginModalCopy.description}
            />
        </div >
    );
}
