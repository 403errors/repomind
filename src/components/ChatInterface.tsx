import { useState, useRef, useEffect, useMemo } from "react";
import { FileCode, ChevronRight, ArrowLeft, Sparkles, Menu, MessageCircle, Shield, Download, Trash2, X, GitFork } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { BotIcon } from "@/components/icons/BotIcon";
import { UserAvatar } from "./UserAvatar";
import { CopySquaresIcon } from "@/components/icons/CopySquaresIcon";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { scanRepositoryVulnerabilities, fetchProfile, getRemainingDeepScans, getLatestRepoScanId, createScanShareLink } from "@/app/actions";
import { cn } from "@/lib/utils";
import { countMessageTokens, formatTokenCount, getTokenWarningLevel, isRateLimitError, getRateLimitErrorMessage, MAX_TOKENS } from "@/lib/tokens";
import { saveConversation, loadConversation, clearConversation } from "@/lib/storage";
import {
    ARCHITECTURE_PROMPT,
    COPY_FEEDBACK_MS,
    DEEP_SCAN_PROMPT,
    INITIAL_PROMPT_DELAY_MS,
    MAX_FINDINGS_PREVIEW,
    QUICK_SCAN_PROMPT,
} from "@/lib/chat-constants";
import { copyChatMessageContent, exportChatMessages } from "@/lib/chat-message-actions";
import { parseStreamChunk } from "@/lib/streaming-parser";
import { shouldShowRepoSuggestions } from "@/lib/chat-ui";

import { SearchModal } from "./SearchModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ChatInput } from "./ChatInput";
import { LoginModal } from "./LoginModal";
import { ReasoningBlock } from "./ReasoningBlock";
import type { ModelPreference } from "@/lib/ai-client";
import type { RepoChatMessage } from "@/lib/chat-types";

import { MessageContent } from "./chat/MessageContent";
import { useMessageSelection } from "./chat/useMessageSelection";
import { BadgeModal } from "./chat/BadgeModal";
import { SecurityScanModal } from "./chat/SecurityScanModal";
import { buildSecurityScanMessage } from "./chat/security-scan-message";
import { StreamStatus } from "./chat/StreamStatus";

const REPO_SUGGESTIONS = [
    "Show me the user flow chart",
    "Evaluate code quality",
    "What's the tech stack?",
    ARCHITECTURE_PROMPT,
];

interface RepoFileNode {
    path: string;
    sha?: string;
}

type OwnerProfile = Awaited<ReturnType<typeof fetchProfile>>;

interface ChatInterfaceProps {
    repoContext: { owner: string; repo: string; fileTree: RepoFileNode[] };
    onToggleSidebar?: () => void;
    initialPrompt?: string;
}

type SubmitMode = "normal" | "quick_scan" | "deep_scan";
type HttpError = Error & { status?: number; code?: string };
type ChatRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

function areRepoMessagesEquivalent(left: RepoChatMessage[], right: RepoChatMessage[]): boolean {
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

// Keep this in sync with server-side pruneFilePaths to avoid sending noisy/binary paths in request payloads.
const REQUEST_FILE_PATH_SKIP_PATTERN =
    /(\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css|woff|woff2|ttf|otf|eot)|package-lock\.json|yarn\.lock)$/i;

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
        return "An unexpected error occurred while analyzing the code.";
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

export function ChatInterface({ repoContext, onToggleSidebar, initialPrompt }: ChatInterfaceProps) {
    const { data: session, status: sessionStatus } = useSession();
    const shouldUseCloudStorage = sessionStatus !== "unauthenticated";
    const [messages, setMessages] = useState<RepoChatMessage[]>([
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
    const [connectionLost, setConnectionLost] = useState(false);

    const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
    const [showBadgeModal, setShowBadgeModal] = useState(false);
    const [showSecurityModal, setShowSecurityModal] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginModalCopy, setLoginModalCopy] = useState<{ title?: string; description?: string }>({});
    const [deepScansData, setDeepScansData] = useState<{ used: number; total: number; resetsAt: string; isUnlimited: boolean } | null>(null);
    const [latestScanId, setLatestScanId] = useState<string | null>(null);
    const activeRunKey = useMemo(() => `repomind:chatRun:repo:${repoContext.owner}:${repoContext.repo}`, [repoContext.owner, repoContext.repo]);

    const handleSubmitRef = useRef<((e?: React.FormEvent, overrideText?: string, submitMode?: SubmitMode, scanAiAssist?: boolean) => Promise<void>) | null>(null);
    const isSubmittingRef = useRef(false);

    // Fetch deep scan limits on mount/session change
    useEffect(() => {
        if (session?.user) {
            getRemainingDeepScans().then(setDeepScansData).catch(console.error);
        }
        if (showSecurityModal) {
            getLatestRepoScanId(repoContext.owner, repoContext.repo)
                .then(setLatestScanId)
                .catch(console.error);
        }
    }, [session?.user, showSecurityModal, repoContext.owner, repoContext.repo]);

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
    const initialPromptHandled = useRef(false);
    const restoreGenerationRef = useRef(0);
    const skipNextAutoScrollRef = useRef(false);

    useEffect(() => {
        const restoreGeneration = restoreGenerationRef.current;
        const fetchConversation = async () => {
            const saved = await loadConversation(repoContext.owner, repoContext.repo, shouldUseCloudStorage);
            if (restoreGeneration !== restoreGenerationRef.current) {
                return;
            }
            if (saved && saved.length > 1) {
                setMessages((prev) => {
                    if (areRepoMessagesEquivalent(prev, saved)) {
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

            if (initialPrompt && !initialPromptHandled.current) {
                initialPromptHandled.current = true;
                let promptText = "";
                if (initialPrompt === "architecture") promptText = ARCHITECTURE_PROMPT;
                else if (initialPrompt === "security") promptText = QUICK_SCAN_PROMPT;
                else if (initialPrompt === "explain") promptText = "Explain the codebase";
                else promptText = initialPrompt;

                const url = new URL(window.location.href);
                url.searchParams.delete('prompt');
                window.history.replaceState({}, '', url.toString());

                setTimeout(() => {
                    if (handleSubmitRef.current) {
                        handleSubmitRef.current(undefined, promptText);
                    }
                }, INITIAL_PROMPT_DELAY_MS);
            }
        };

        fetchConversation();
    }, [repoContext.owner, repoContext.repo, initialPrompt, shouldUseCloudStorage, activeRunKey]);

    // Save on every message change
    useEffect(() => {
        if (initialized && messages.length > 1) {
            void saveConversation(repoContext.owner, repoContext.repo, messages, shouldUseCloudStorage);
        }
    }, [messages, initialized, repoContext.owner, repoContext.repo, shouldUseCloudStorage]);

    // Calculate total token count
    const totalTokens = useMemo(() => {
        return countMessageTokens(messages.map(m => ({ role: m.role, parts: m.content })));
    }, [messages]);

    const tokenWarningLevel = getTokenWarningLevel(totalTokens);

    useEffect(() => {
        const nextShowSuggestions = shouldShowRepoSuggestions({
            messagesCount: messages.length,
            input,
            loading,
            scanning,
        });
        setShowSuggestions(nextShowSuggestions);
    }, [messages.length, input, loading, scanning]);

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

    const isQuickSecurityScanPrompt = (text: string) => {
        const normalized = text.toLowerCase();
        return normalized.includes(QUICK_SCAN_PROMPT.toLowerCase()) || normalized.includes("scan for vulnerabilities");
    };

    const isDeepSecurityScanPrompt = (text: string) => {
        const normalized = text.toLowerCase();
        return normalized.includes(DEEP_SCAN_PROMPT.toLowerCase()) || normalized.includes("deep scan");
    };

    const runSecurityScanFlow = async (
        isQuickScan: boolean,
        isDeepScan: boolean,
        placeholderMessageId: string
    ) => {
        console.log(`🎯 Security scan triggered! (Type: ${isDeepScan ? "Deep" : "Quick"})`);
        setScanning(true);
        try {
            const filesToScan = repoContext.fileTree.map((file) => ({ path: file.path, sha: file.sha }));
            const { findings, summary, scanId, meta } = await scanRepositoryVulnerabilities(
                repoContext.owner,
                repoContext.repo,
                filesToScan,
                {
                    analysisProfile: isDeepScan ? "deep" : "quick",
                    aiAssist: "on",
                }
            );

            const content = buildSecurityScanMessage({
                summary,
                findings,
                isFromCache: Boolean(meta?.fromCache),
                maxFindingsPreview: MAX_FINDINGS_PREVIEW,
            });

            const modelMsg: RepoChatMessage = {
                id: placeholderMessageId,
                role: "model",
                content,
                vulnerabilities: findings,
                isQuickSecurityScan: isQuickScan && !isDeepScan,
                scanId,
            };
            setMessages((prev) => prev.map((message) =>
                message.id === placeholderMessageId ? modelMsg : message
            ));
            // Update latest scan ID after successful scan
            if (scanId) {
                setLatestScanId(scanId);
            }
        } catch (error) {
            console.error("Scan failed:", error);
            const errorMessage = error instanceof Error ? error.message : "An error occurred during scanning";
            const isDeepScanLimitReached = isDeepScan && /monthly deep scan limit reached/i.test(errorMessage);

            toast.error(isDeepScanLimitReached ? "Deep scan limit exhausted" : "Security scan failed", {
                description: isDeepScanLimitReached
                    ? "Your monthly deep scan limit is exhausted. Contact admin pieisnot22by7@gmail.com for more reasonable limits."
                    : errorMessage,
            });

            const errorMsg: RepoChatMessage = isDeepScanLimitReached
                ? {
                    id: placeholderMessageId,
                    role: "model",
                    content: "Your deep scan limit is exhausted for this month.\n\nPlease contact admin at **pieisnot22by7@gmail.com** for more reasonable limits.",
                }
                : {
                    id: placeholderMessageId,
                    role: "model",
                    content: "I encountered an error while scanning for security vulnerabilities. Please try again.",
                };
            setMessages((prev) => prev.map((message) =>
                message.id === placeholderMessageId ? errorMsg : message
            ));
        } finally {
            setScanning(false);
            setLoading(false);
            isSubmittingRef.current = false;
        }
    };

    const getRepoQueryForServer = (trimmedInput: string, combinedInput: string) => {
        if (trimmedInput.toLowerCase() === ARCHITECTURE_PROMPT.toLowerCase()) {
            return "Explain the architecture of this repository in detail. Provide a comprehensive overview of the core logic, framework setup, data flow, and key components based on the actual code, not just the README. Include a visual architecture diagram, preferring an SVG code block when possible (Mermaid is acceptable fallback).";
        }
        return combinedInput;
    };

    const startRepoStreamMessage = (selectedModelPreference: ModelPreference) => {
        const modelMsgId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, {
            id: modelMsgId,
            role: "model",
            content: "",
            reasoningSteps: [],
            relevantFiles: [],
            modelUsed: selectedModelPreference,
            streamStatus: "Selecting relevant files",
            streamProgress: 5,
        }]);
        return modelMsgId;
    };

    const runRepoStreamingFlow = async (
        modelMsgId: string,
        combinedInputForServer: string,
        selectedModelPreference: ModelPreference
    ) => {
        const isThinkingStream = selectedModelPreference === "thinking";
        const eligibleFiles = repoContext.fileTree
            .filter((path) =>
                !REQUEST_FILE_PATH_SKIP_PATTERN.test(path.path) &&
                !path.path.includes("node_modules/") &&
                !path.path.includes(".git/")
            );
        const filePaths = eligibleFiles.map((file) => file.path);
        const fileShas = Object.fromEntries(
            eligibleFiles
                .filter((file) => typeof file.sha === "string" && file.sha.length > 0)
                .map((file) => [file.path, file.sha as string])
        );
        const historyForServer = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }));
        setConnectionLost(false);

        const clientRequestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const runCreateRes = await fetch("/api/chat/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scope: "repo",
                owner: repoContext.owner,
                repo: repoContext.repo,
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

        const response = await fetch("/api/chat/repo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: combinedInputForServer,
                repoDetails: { owner: repoContext.owner, repo: repoContext.repo },
                filePaths,
                fileShas,
                history: historyForServer,
                profileData: ownerProfile,
                modelPreference: selectedModelPreference,
                runId,
            }),
        });

        if (!response.ok || !response.body) {
            const rawResponseText = await response.text().catch(() => "");
            const parsedError = parseResponseError(rawResponseText, response.status);
            const httpError = new Error(parsedError.message) as HttpError;
            httpError.status = response.status;
            httpError.code = parsedError.code;

            console.error("Repo chat stream initialization failed", {
                owner: repoContext.owner,
                repo: repoContext.repo,
                status: response.status,
                statusText: response.statusText,
                filePathCount: filePaths.length,
                historyMessageCount: historyForServer.length,
                queryPreview: combinedInputForServer.slice(0, 160),
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
        let finalRelevantFiles: string[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

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
                } else if (chunk.type === "files") {
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId ? { ...message, relevantFiles: chunk.files } : message
                    ));
                } else if (chunk.type === "complete") {
                    finalRelevantFiles = chunk.relevantFiles ?? [];
                    setMessages((prev) => prev.map((message) =>
                        message.id === modelMsgId
                            ? {
                                ...message,
                                relevantFiles: finalRelevantFiles,
                                commitFreshnessLabel: chunk.metadata?.commitFreshnessLabel,
                                toolsUsed: chunk.metadata?.toolsUsed,
                                processingSummary: chunk.metadata?.processingSummary,
                                sourceScope: chunk.metadata?.sourceScope,
                                streamStatus: "Completed",
                                streamProgress: 100,
                            }
                            : message
                    ));
                } else if (chunk.type === "error") {
                    const streamError = new Error(chunk.message) as HttpError;
                    streamError.code = chunk.code;
                    throw streamError;
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

        setMessages(prev => prev.map(m =>
            m.id === modelMsgId
                ? { ...m, content: contentText, streamStatus: "Completed", streamProgress: 100 }
                : m
        ));

        if (runId) {
            window.sessionStorage.removeItem(activeRunKey);
        }
    };

    const handleSubmit = async (
        e?: React.FormEvent,
        overrideText?: string,
        submitMode: SubmitMode = "normal"
    ) => {
        if (e) e.preventDefault();

        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;

        const trimmedInput = overrideText || input.trim();
        if ((!trimmedInput && !referenceText) || loading) {
            isSubmittingRef.current = false;
            return;
        }

        const isQuickScan = submitMode === "quick_scan" || isQuickSecurityScanPrompt(trimmedInput);
        const isDeepScan = submitMode === "deep_scan" || isDeepSecurityScanPrompt(trimmedInput);
        const selectedModelPreference: ModelPreference = modelPreference;

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

        const userMsg: RepoChatMessage = {
            id: Date.now().toString(),
            role: "user",
            content: combinedInput,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        clearReference();
        setLoading(true);

        if (isQuickScan || isDeepScan) {
            const placeholderMessageId = `scan-${Date.now()}`;
            const placeholderMsg: RepoChatMessage = {
                id: placeholderMessageId,
                role: "model",
                content: "",
                scanStatus: isDeepScan ? "deep_running" : "quick_running",
            };
            setMessages((prev) => [...prev, placeholderMsg]);
            await runSecurityScanFlow(isQuickScan, isDeepScan, placeholderMessageId);
            return;
        }

        try {
            const combinedInputForServer = getRepoQueryForServer(trimmedInput, combinedInput);
            const modelMsgId = startRepoStreamMessage(selectedModelPreference);
            await runRepoStreamingFlow(modelMsgId, combinedInputForServer, selectedModelPreference);
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
                toast.error("Login required for more repo tooling", {
                    description: "Anonymous repo-tool usage limit reached.",
                    duration: 5000,
                });
                setLoginModalCopy({
                    title: "Login To Continue Repo Chat",
                    description: "Unlock 3x tool budget, Thinking Mode, and faster repo answers by signing in.",
                });
                setShowLoginModal(true);
            } else if (isAuthUsageLimit) {
                const limitMessage: RepoChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: "Usage limit reached for repo chat tools.\n\nPlease contact **pieisnot22by7@gmail.com** for extended limits.",
                };
                setMessages((prev) => [...prev, limitMessage]);
            } else if (isAuthError) {
                toast.error("Sign in required", {
                    description: "Your session has expired or is invalid. Please sign in and try again.",
                    duration: 5000,
                });
                setLoginModalCopy({
                    title: "Sign In Required",
                    description: "Please sign in with GitHub to continue repo analysis features.",
                });
                setShowLoginModal(true);
            } else if (isPayloadTooLarge) {
                toast.error("Request too large", {
                    description: "This repository is large. Ask about a specific folder or feature and try again.",
                    duration: 5000,
                });
            } else if (isRateLimitError(error)) {
                toast.error(getRateLimitErrorMessage(error), {
                    description: "Please wait a few moments before trying again.",
                    duration: 5000,
                });
            } else {
                toast.error("Failed to analyze code", {
                    description: userFacingError,
                });
            }

            if (!isAuthError && !isAnonUsageLimit && !isAuthUsageLimit) {
                const errorMsg: RepoChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: "model",
                    content: isPayloadTooLarge
                        ? "This request was too large to process. Try a narrower question focused on a specific module or folder."
                        : `I encountered an error while analyzing the code.\n\n${userFacingError}`,
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

    useEffect(() => {
        handleSubmitRef.current = handleSubmit;
    });

    const handleClearChat = async () => {
        restoreGenerationRef.current += 1;
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(activeRunKey);
        }
        await clearConversation(repoContext.owner, repoContext.repo, shouldUseCloudStorage);
        setLoading(false);
        setConnectionLost(false);
        setInitialized(true);
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

    const handleCopyMessage = async (message: RepoChatMessage) => {
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
        const contextLabel = `${repoContext.owner}/${repoContext.repo}`;
        await exportChatMessages({
            title: `${contextLabel} Chat Export`,
            contextLabel,
            messages,
        });
        toast.success("Chat exported");
    };

    const handleRunQuickScanFromModal = (scanAiAssist: boolean) => {
        setShowSecurityModal(false);
        handleSubmitRef.current?.(undefined, QUICK_SCAN_PROMPT, "quick_scan", scanAiAssist);
    };

    const handleRunDeepScanFromModal = (scanAiAssist: boolean) => {
        setShowSecurityModal(false);
        if (!session) {
            setShowLoginModal(true);
            return;
        }
        handleSubmitRef.current?.(undefined, DEEP_SCAN_PROMPT, "deep_scan", scanAiAssist);
    };

    return (
        <div className="flex flex-col h-full bg-black text-white relative">
            {/* Repo Header */}
            <div className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/95 shrink-0 shadow-lg">
                <div className="flex items-center justify-between px-4 h-16 w-full gap-4">
                    {/* Left Section: Breadcrumbs & Context */}
                    <div className="flex items-center gap-3 min-w-0 shrink">
                        {onToggleSidebar && (
                            <button
                                onClick={onToggleSidebar}
                                className="md:hidden p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                            >
                                <Menu className="w-5 h-5" />
                            </button>
                        )}
                        <Link
                            href="/"
                            className="hidden md:flex p-2 -ml-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                            title="Back to home"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>

                        <div className="flex items-center gap-2 min-w-0 ml-2">
                            <h1 className="text-sm font-medium text-zinc-400 truncate flex items-center gap-1.5">
                                <Link href="/" className="hover:text-white transition-colors">repomind</Link>
                                <span className="text-zinc-700">/</span>
                                <span className="text-zinc-100 font-semibold tracking-tight">{repoContext.owner}</span>
                                <span className="text-zinc-700">/</span>
                                <span className="text-white font-bold">{repoContext.repo}</span>
                            </h1>
                            <Link
                                href={`/repo/${repoContext.owner}/${repoContext.repo}`}
                                className="hidden lg:flex items-center text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-white transition-all border border-white/5"
                            >
                                Profile
                            </Link>
                        </div>
                    </div>

                    {/* Right Section: Actions & Metrics */}
                    <div className="flex items-center gap-3 shrink-0 overflow-x-auto no-scrollbar pr-2">
                        <div className="hidden md:flex items-center p-1 bg-zinc-900/50 border border-white/5 rounded-xl shadow-inner gap-1">
                            <button
                                onClick={() => handleSubmit(undefined, ARCHITECTURE_PROMPT)}
                                disabled={loading || scanning}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-all disabled:opacity-50"
                            >
                                <GitFork className="w-3.5 h-3.5" />
                                <span className="hidden lg:inline">Architecture</span>
                            </button>
                            <button
                                onClick={() => {
                                    if (!session) {
                                        setShowLoginModal(true);
                                        return;
                                    }
                                    setShowSecurityModal(true);
                                }}
                                disabled={loading || scanning}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50"
                            >
                                <Shield className="w-3.5 h-3.5" />
                                <span className="hidden lg:inline">Security</span>
                            </button>
                        </div>



                        {/* Tokens */}
                        <div className={cn(
                            "hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border shadow-inner shrink-0 transition-colors",
                            tokenWarningLevel === 'danger' ? "bg-red-500/5 text-red-400 border-red-500/20" :
                                tokenWarningLevel === 'warning' ? "bg-yellow-500/5 text-yellow-400 border-yellow-500/20" :
                                    "bg-zinc-900 text-zinc-400 border-white/5"
                        )}>
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>{formatTokenCount(totalTokens)} / <span className="opacity-50">{formatTokenCount(MAX_TOKENS)}</span></span>
                        </div>

                        {/* Utility Bar */}
                        <div className="flex items-center gap-0.5 pl-3 border-l border-white/10 shrink-0">
                            <SearchModal
                                repoContext={repoContext}
                                onSendMessage={(role, content) => {
                                    setMessages(prev => [...prev, { id: Date.now().toString(), role, content }]);
                                }}
                            />
                            <button
                                onClick={handleExportChat}
                                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors group relative"
                                title="Export Chat"
                            >
                                <Download className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
                            </button>
                            <button
                                onClick={() => setShowClearConfirm(true)}
                                className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors group relative"
                                title="Clear Chat"
                            >
                                <Trash2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>



            <div
                ref={chatScrollRef}
                onMouseUp={handleSelection}
                className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-6 relative isolate z-0 selection:bg-blue-500/50 selection:text-white [&_*::selection]:bg-blue-500/50 [&_*::selection]:text-white"
            >
                {connectionLost && (
                    <div className="max-w-4xl mx-auto">
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
                        const isStreamingScanPlaceholder =
                            msg.role === "model" &&
                            Boolean(msg.scanStatus) &&
                            loading &&
                            scanning &&
                            isLatestMessage;

                        return (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex gap-4 max-w-4xl mx-auto",
                                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                                )}
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden",
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
                                    msg.role === "user" ? "items-end max-w-[85%] md:max-w-[80%]" : "items-start max-w-full md:max-w-full w-full min-w-0"
                                )}>
                                    {msg.role === "model" && msg.modelUsed !== "thinking" && (
                                        <StreamStatus
                                            message={msg.streamStatus}
                                            isStreaming={loading && msg.id === messages[messages.length - 1]?.id}
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
                                    {(msg.role === "user" || msg.content || isStreamingScanPlaceholder) && (
                                        <div className={cn(
                                            "relative px-4 py-2.5 rounded-2xl overflow-hidden w-full min-w-0",
                                            msg.role === "user"
                                                ? "bg-blue-600 text-white rounded-tr-none"
                                                : "bg-zinc-900 border border-white/10 rounded-tl-none"
                                        )}
                                            data-message-role={msg.role}
                                        >
                                            {msg.role === "model" && msg.content && (
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
                                            <div className="prose prose-invert prose-sm max-w-none leading-relaxed break-words [overflow-wrap:anywhere] overflow-x-hidden w-full min-w-0">
                                                {isStreamingScanPlaceholder && (
                                                    <div className="not-prose flex items-center gap-2 py-1 text-sm font-medium text-zinc-300">
                                                        <span>{msg.scanStatus === "deep_running" ? "Deep Scan Running" : "Quick Scan Running"}</span>
                                                        <span className="flex gap-1 items-center">
                                                            {[0, 1, 2].map((i) => (
                                                                <span
                                                                    key={i}
                                                                    className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse"
                                                                    style={{ animationDelay: `${i * 0.2}s` }}
                                                                />
                                                            ))}
                                                        </span>
                                                    </div>
                                                )}
                                                {msg.content && (
                                                <MessageContent
                                                    content={msg.content + (loading && isLatestMessage && !msg.scanStatus ? "▋" : "")}
                                                    messageId={msg.id}
                                                    messages={messages}
                                                    currentOwner={repoContext.owner}
                                                    currentRepo={repoContext.repo}
                                                    isStreaming={loading && isLatestMessage && !msg.scanStatus}
                                                    fileTree={repoContext.fileTree}
                                                />
                                            )}
                                            </div>
                                            {msg.scanId && (
                                                <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-3">
                                                    <Link
                                                        href={`/report/${msg.scanId}`}
                                                        target="_blank"
                                                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors shadow-sm"
                                                    >
                                                        <Shield className="w-3.5 h-3.5" />
                                                        View Full Report
                                                    </Link>
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                const link = await createScanShareLink(msg.scanId!);
                                                                await navigator.clipboard.writeText(link.url);
                                                                toast.success("Signed report link copied!", {
                                                                    description: `Expires on ${new Date(link.expiresAt).toLocaleDateString()}`,
                                                                });
                                                            } catch (error) {
                                                                const message = error instanceof Error ? error.message : "Failed to share report";
                                                                toast.error("Failed to share report", { description: message });
                                                            }
                                                        }}
                                                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg transition-colors shadow-sm"
                                                    >
                                                        <CopySquaresIcon className="w-3.5 h-3.5" />
                                                        Share Report
                                                    </button>
                                                </div>
                                            )}
                                            {msg.isQuickSecurityScan && (
                                                <div className="mt-4 pt-4 border-t border-white/10">
                                                    <p className="text-sm text-zinc-400 mb-3">Want a more thorough analysis?</p>
                                                    <button
                                                        onClick={() => handleSubmit(undefined, DEEP_SCAN_PROMPT, "deep_scan")}
                                                        disabled={loading || scanning}
                                                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-xl transition-all disabled:opacity-50 group"
                                                    >
                                                        <Shield className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
                                                        Run Deep Scan
                                                    </button>
                                                </div>
                                            )}
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

                                    {msg.relevantFiles && msg.relevantFiles.length > 0 && !(loading && msg.id === messages[messages.length - 1]?.id) && (
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
                            </div>
                        );
                    })}


                <div ref={messagesEndRef} />
            </div>

            <div className="relative z-40 p-4 border-t border-white/10 bg-zinc-950/95 space-y-3">
                {referenceText && (
                    <div className="max-w-4xl mx-auto">
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
                        className="max-w-4xl mx-auto"
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

                <form id="chat-form" onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
                    <ChatInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleSubmit}
                        placeholder={totalTokens >= MAX_TOKENS ? "Conversation limit reached. Please clear chat." : "Ask about the code, architecture, or features..."}
                        disabled={totalTokens >= MAX_TOKENS}
                        loading={loading}
                        allowEmptySubmit={Boolean(referenceText)}
                        modelPreference={modelPreference}
                        setModelPreference={setModelPreference}
                        onRequireAuth={() => {
                            setLoginModalCopy({
                                title: "Login Required For Thinking Mode",
                                description: "Sign in to use Thinking Mode and higher repo-tool limits.",
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

            <BadgeModal
                isOpen={showBadgeModal}
                owner={repoContext.owner}
                repo={repoContext.repo}
                onClose={() => setShowBadgeModal(false)}
            />

            <SecurityScanModal
                isOpen={showSecurityModal}
                isAuthenticated={Boolean(session)}
                deepScansData={deepScansData}
                latestScanId={latestScanId}
                onClose={() => setShowSecurityModal(false)}
                onRunQuickScan={handleRunQuickScanFromModal}
                onRunDeepScan={handleRunDeepScanFromModal}
            />

            <LoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
                title={loginModalCopy.title}
                description={loginModalCopy.description}
            />
        </div>
    );
}
