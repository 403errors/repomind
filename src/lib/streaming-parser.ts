import type { StreamUpdate } from "@/lib/streaming-types";

interface ParsedChunk {
    updates: StreamUpdate[];
    invalidLines: string[];
    buffer: string;
}

const STREAM_UPDATE_TYPES = new Set([
    "status",
    "tool",
    "thought",
    "content",
    "files",
    "complete",
    "error",
]);

function isStreamUpdate(value: unknown): value is StreamUpdate {
    if (!value || typeof value !== "object") {
        return false;
    }

    const maybeType = (value as { type?: unknown }).type;
    return typeof maybeType === "string" && STREAM_UPDATE_TYPES.has(maybeType);
}

export function parseStreamChunk(buffer: string, chunkText: string): ParsedChunk {
    const combined = buffer + chunkText;
    const lines = combined.split("\n");
    const nextBuffer = lines.pop() ?? "";

    const updates: StreamUpdate[] = [];
    const invalidLines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (isStreamUpdate(parsed)) {
                updates.push(parsed);
            } else {
                invalidLines.push(trimmed);
            }
        } catch {
            invalidLines.push(trimmed);
        }
    }

    return { updates, invalidLines, buffer: nextBuffer };
}
