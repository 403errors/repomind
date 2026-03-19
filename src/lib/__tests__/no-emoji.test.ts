import { describe, expect, it } from "vitest";

import { stripEmojiCharacters } from "@/lib/no-emoji";

describe("stripEmojiCharacters", () => {
    it("removes emoji characters while preserving plain text", () => {
        expect(stripEmojiCharacters("Hello, world! 🚀 Keep going.")).toBe("Hello, world!  Keep going.");
    });

    it("removes emoji-style symbols from markdown headings", () => {
        expect(stripEmojiCharacters("### ⚠️ Vulnerabilities")).toBe("###  Vulnerabilities");
    });
});
