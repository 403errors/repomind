/**
 * Type definitions for streaming server action responses
 */

import type { ChatMessageBase } from "@/lib/chat-types";

export type StreamUpdate =
    | { type: "status"; message: string; progress: number }
    | { type: "tool"; name: string; detail?: string; usageUnits?: number; billable?: boolean }
    | { type: "thought"; text: string }
    | { type: "content"; text: string; append: boolean }
    | { type: "files"; files: string[] }
    | {
        type: "complete";
        relevantFiles: string[];
        metadata?: {
            commitFreshnessLabel?: string;
            toolsUsed?: string[];
            processingSummary?: string[];
            sourceScope?: string;
        };
    }
    | { type: "error"; message: string; code?: string };

export type StreamingMessage = ChatMessageBase;

export interface StreamingState {
    status: string;
    progress: number;
    isStreaming: boolean;
}
