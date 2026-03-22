import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MERMAID_THEME_CSS, MERMAID_THEME_VARIABLES } from "@/lib/mermaid-init";

const mermaidInitSource = readFileSync(
    path.resolve(process.cwd(), "src/lib/mermaid-init.ts"),
    "utf8"
);

describe("mermaid init theme", () => {
    it("includes ER-specific contrast overrides", () => {
        expect(MERMAID_THEME_VARIABLES.mainBkg).toBe("#18181b");
        expect(MERMAID_THEME_VARIABLES.nodeTextColor).toBe("#e4e4e7");
        expect(MERMAID_THEME_VARIABLES.rowOdd).toBe("#27272a");
        expect(MERMAID_THEME_VARIABLES.rowEven).toBe("#1f1f23");
        expect(MERMAID_THEME_CSS).toContain(".er .entityBox");
        expect(MERMAID_THEME_CSS).toContain(".er .relationshipLabelBox");
        expect(MERMAID_THEME_CSS).toContain(".er g.row-rect-odd path");
        expect(MERMAID_THEME_CSS).toContain(".er .label");
    });

    it("provides xychart defaults and avoids brittle mindmap/xychart selectors", () => {
        expect(MERMAID_THEME_VARIABLES.xyChart.backgroundColor).toBe("transparent");
        expect(MERMAID_THEME_VARIABLES.xyChart.plotColorPalette).toContain("#60a5fa");
        expect(MERMAID_THEME_CSS).not.toContain(".mindmap .node:nth-of-type");
        expect(MERMAID_THEME_CSS).not.toContain(".xychart .plot");
    });

    it("sets compact tidy-tree defaults for mindmaps", () => {
        expect(mermaidInitSource).toContain("layoutAlgorithm: \"tidy-tree\"");
        expect(mermaidInitSource).toContain("maxNodeWidth: 170");
        expect(mermaidInitSource).toContain("padding: 6");
    });
});
