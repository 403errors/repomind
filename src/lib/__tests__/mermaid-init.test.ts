import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MERMAID_THEME_CSS, MERMAID_THEME_VARIABLES } from "@/lib/mermaid-init";

const mermaidInitSource = readFileSync(
    path.resolve(process.cwd(), "src/lib/mermaid-init.ts"),
    "utf8"
);

describe("mermaid init theme", () => {
    it("includes branded high-contrast defaults", () => {
        expect(MERMAID_THEME_VARIABLES.primaryColor).toBe("#4f46e5");
        expect(MERMAID_THEME_VARIABLES.mainBkg).toBe("#111827");
        expect(MERMAID_THEME_VARIABLES.nodeTextColor).toBe("#f8fafc");
        expect(MERMAID_THEME_VARIABLES.lineColor).toBe("#6366f1");
        expect(MERMAID_THEME_VARIABLES.rowOdd).toBe("#1f2937");
        expect(MERMAID_THEME_VARIABLES.rowEven).toBe("#0f172a");
        expect(MERMAID_THEME_CSS).toContain(".er .entityBox");
        expect(MERMAID_THEME_CSS).toContain(".er .relationshipLabelBox");
        expect(MERMAID_THEME_CSS).toContain(".er g.row-rect-odd path");
        expect(MERMAID_THEME_CSS).toContain(".er .label");
    });

    it("provides xychart defaults and shared edge/node style hooks", () => {
        expect(MERMAID_THEME_VARIABLES.xyChart.backgroundColor).toBe("transparent");
        expect(MERMAID_THEME_VARIABLES.xyChart.plotColorPalette).toContain("#4f46e5");
        expect(MERMAID_THEME_CSS).not.toContain(".mindmap .node:nth-of-type");
        expect(MERMAID_THEME_CSS).not.toContain(".xychart .plot");
        expect(MERMAID_THEME_CSS).toContain(".edgePath path");
        expect(MERMAID_THEME_CSS).toContain("stroke-width: 1.5px");
        expect(MERMAID_THEME_CSS).toContain(".cluster rect");
    });

    it("sets compact tidy-tree defaults for mindmaps", () => {
        expect(mermaidInitSource).toContain("layoutAlgorithm: \"tidy-tree\"");
        expect(mermaidInitSource).toContain("maxNodeWidth: 170");
        expect(mermaidInitSource).toContain("padding: 6");
    });
});
