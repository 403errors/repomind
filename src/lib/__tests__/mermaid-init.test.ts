import { describe, expect, it } from "vitest";
import { MERMAID_THEME_CSS, MERMAID_THEME_VARIABLES } from "@/lib/mermaid-init";

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
});
