import type { ModelPreference } from "@/lib/ai-client";
import type { SecurityFinding } from "@/lib/security-scanner";

export type ChatRole = "user" | "model";

export interface ChatMessageBase {
    [key: string]: unknown;
    id: string;
    role: ChatRole;
    content: string;
    relevantFiles?: string[];
    streamStatus?: string;
    streamProgress?: number;
    commitFreshnessLabel?: string;
    toolsUsed?: string[];
    processingSummary?: string[];
    sourceScope?: string;
}

export interface ThinkingChatMessage extends ChatMessageBase {
    reasoningSteps?: string[];
    modelUsed?: ModelPreference;
}

export interface RepoChatMessage extends ThinkingChatMessage {
    tokenCount?: number;
    vulnerabilities?: SecurityFinding[];
    isQuickSecurityScan?: boolean;
    scanId?: string;
    scanStatus?: "quick_running" | "deep_running";
}

export type ProfileChatMessage = ThinkingChatMessage;

export type StoredMessage = ChatMessageBase;
