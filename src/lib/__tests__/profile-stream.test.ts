import { describe, expect, it } from "vitest";

import { mapProfileStreamChunk } from "@/lib/profile-stream";

describe("mapProfileStreamChunk", () => {
    it("maps STATUS chunks to status updates", () => {
        expect(mapProfileStreamChunk("STATUS:Loading profile")).toEqual({
            type: "status",
            message: "Loading profile",
            progress: 85,
        });
    });

    it("maps THOUGHT chunks to thought updates", () => {
        expect(mapProfileStreamChunk("THOUGHT:Reasoning step")).toEqual({
            type: "thought",
            text: "Reasoning step",
        });
    });

    it("maps TOOL chunks to tool updates", () => {
        expect(mapProfileStreamChunk("TOOL:{\"name\":\"fetch_recent_commits\",\"detail\":\"overall\",\"usageUnits\":1}")).toEqual({
            type: "tool",
            name: "fetch_recent_commits",
            detail: "overall",
            usageUnits: 1,
        });
    });

    it("preserves billable flag from TOOL chunks", () => {
        expect(mapProfileStreamChunk("TOOL:{\"name\":\"fetch_recent_commits\",\"usageUnits\":1,\"billable\":false}")).toEqual({
            type: "tool",
            name: "fetch_recent_commits",
            usageUnits: 1,
            billable: false,
        });
    });

    it("maps non-prefixed chunks to content updates", () => {
        expect(mapProfileStreamChunk("Final answer chunk")).toEqual({
            type: "content",
            text: "Final answer chunk",
            append: true,
        });
    });

    it("falls back to content when TOOL payload is malformed", () => {
        expect(mapProfileStreamChunk("TOOL:{not-json}")).toEqual({
            type: "content",
            text: "TOOL:{not-json}",
            append: true,
        });
    });
});
