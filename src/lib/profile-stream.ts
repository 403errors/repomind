import type { StreamUpdate } from "@/lib/streaming-types";

export function mapProfileStreamChunk(chunk: string): StreamUpdate {
    if (chunk.startsWith("STATUS:")) {
        return { type: "status", message: chunk.replace("STATUS:", "").trim(), progress: 85 };
    }

    if (chunk.startsWith("TOOL:")) {
        try {
            const parsed = JSON.parse(chunk.replace("TOOL:", "").trim()) as {
                name?: unknown;
                detail?: unknown;
                usageUnits?: unknown;
            };
            if (typeof parsed.name === "string") {
                return {
                    type: "tool",
                    name: parsed.name,
                    detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
                    usageUnits: typeof parsed.usageUnits === "number" ? parsed.usageUnits : undefined,
                };
            }
        } catch {
            // Fall through to content when TOOL payload is malformed.
        }
    }

    if (chunk.startsWith("THOUGHT:")) {
        return { type: "thought", text: chunk.replace("THOUGHT:", "") };
    }

    return { type: "content", text: chunk, append: true };
}
