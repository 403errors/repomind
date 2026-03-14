import { describe, expect, it } from "vitest";

import { parseStreamChunk } from "@/lib/streaming-parser";

describe("parseStreamChunk", () => {
    it("parses newline-delimited stream updates and keeps trailing buffer", () => {
        const raw = [
            JSON.stringify({ type: "status", message: "Analyzing", progress: 25 }),
            JSON.stringify({ type: "content", text: "Partial", append: true }),
            "{\"type\":\"content\",\"text\":\"incomplete",
        ].join("\n");

        const parsed = parseStreamChunk("", raw);

        expect(parsed.updates).toHaveLength(2);
        expect(parsed.updates[0]).toMatchObject({ type: "status", message: "Analyzing" });
        expect(parsed.updates[1]).toMatchObject({ type: "content", text: "Partial" });
        expect(parsed.buffer).toContain("incomplete");
    });

    it("records invalid JSON lines separately", () => {
        const parsed = parseStreamChunk(
            "",
            `${JSON.stringify({ type: "thought", text: "step" })}\nnot-json\n`
        );

        expect(parsed.updates).toHaveLength(1);
        expect(parsed.invalidLines).toEqual(["not-json"]);
        expect(parsed.buffer).toBe("");
    });

    it("ignores JSON objects that are not StreamUpdate shapes", () => {
        const parsed = parseStreamChunk("", `${JSON.stringify({ hello: "world" })}\n`);

        expect(parsed.updates).toHaveLength(0);
        expect(parsed.invalidLines).toEqual([JSON.stringify({ hello: "world" })]);
    });

    it("accepts tool updates", () => {
        const parsed = parseStreamChunk(
            "",
            `${JSON.stringify({ type: "tool", name: "fetch_recent_commits", detail: "overall", usageUnits: 1 })}\n`
        );

        expect(parsed.updates).toHaveLength(1);
        expect(parsed.updates[0]).toMatchObject({
            type: "tool",
            name: "fetch_recent_commits",
            detail: "overall",
            usageUnits: 1,
        });
    });
});
