import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mermaidComponentSource = readFileSync(
    path.resolve(process.cwd(), "src/components/Mermaid.tsx"),
    "utf8"
);

describe("Mermaid diagram post-render theming hooks", () => {
    it("targets Mermaid mindmap section classes for node and edge styling", () => {
        expect(mermaidComponentSource).toContain("g.mindmap-node");
        expect(mermaidComponentSource).toContain("section-edge-");
        expect(mermaidComponentSource).toContain("--mindmap-branch-1-fill");
        expect(mermaidComponentSource).toContain("MINDMAP_EDGE_SELECTOR");
        expect(mermaidComponentSource).toContain("isMindmapBlackColor");
        expect(mermaidComponentSource).toContain("getSectionColor(section)");
        expect(mermaidComponentSource).toContain("--mindmap-center-fill");
        expect(mermaidComponentSource).toContain("--mindmap-category-fill");
        expect(mermaidComponentSource).toContain("classifyMindmapNodeTiers");
        expect(mermaidComponentSource).toContain("pickContrastingTextColor");
        expect(mermaidComponentSource).toContain("applyMindmapEdgeGeometryTrim");
        expect(mermaidComponentSource).toContain("MINDMAP_EDGE_STROKE_WIDTH");
        expect(mermaidComponentSource).toContain("resolveMindmapEdgeColor");
        expect(mermaidComponentSource).toContain("getEdgeTerminalPoint");
    });

    it("forces xychart background transparency and themed plot colors", () => {
        expect(mermaidComponentSource).toContain("rect.background");
        expect(mermaidComponentSource).toContain("--xychart-text");
        expect(mermaidComponentSource).toContain("--xychart-axis");
        expect(mermaidComponentSource).toContain("--xychart-bar");
        expect(mermaidComponentSource).toContain("--xychart-line");
    });
});
