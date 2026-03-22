import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const chatInputSource = readFileSync(
    path.resolve(process.cwd(), "src/components/ChatInput.tsx"),
    "utf8"
);
const repoSearchSource = readFileSync(
    path.resolve(process.cwd(), "src/components/RepoSearch.tsx"),
    "utf8"
);

describe("query button modernized styling", () => {
    it("applies focused-input-theme gradient style to chat send button", () => {
        expect(chatInputSource).toContain("from-purple-700 via-purple-600 to-indigo-600");
        expect(chatInputSource).toContain("focus-visible:ring-purple-500/60");
    });

    it("applies matching focused-input-theme gradient style to repo search submit button", () => {
        expect(repoSearchSource).toContain("from-purple-700 via-purple-600 to-indigo-600");
        expect(repoSearchSource).toContain("focus-visible:ring-purple-500/60");
    });
});
