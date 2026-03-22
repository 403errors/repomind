import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getContrastRatio } from "@/lib/color-contrast";

const globalsCssSource = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8"
);

describe("diagram theme tokens", () => {
    it("defines shared diagram tokens and maps mindmap tokens to them", () => {
        expect(globalsCssSource).toContain("--diagram-color-primary");
        expect(globalsCssSource).toContain("--diagram-color-secondary");
        expect(globalsCssSource).toContain("--diagram-color-accent-1");
        expect(globalsCssSource).toContain("--diagram-color-accent-6");
        expect(globalsCssSource).toContain("--diagram-color-line");
        expect(globalsCssSource).toContain("--diagram-color-surface");
        expect(globalsCssSource).toContain("--diagram-color-text-on-color");
        expect(globalsCssSource).toContain("--mindmap-branch-1-fill: var(--diagram-color-accent-1)");
        expect(globalsCssSource).toContain("--mindmap-center-fill: var(--diagram-color-primary)");
        expect(globalsCssSource).toContain("--mindmap-category-fill: var(--diagram-color-secondary)");
    });

    it("keeps all branded node colors at AA contrast for white text", () => {
        const whiteText = "#f8fafc";
        const palette = ["#4f46e5", "#1f2937", "#1d4ed8", "#0e7490", "#047857", "#6d28d9", "#b45309", "#be185d"];

        for (const color of palette) {
            const contrast = getContrastRatio(color, whiteText);
            expect(contrast).not.toBeNull();
            expect(contrast!).toBeGreaterThanOrEqual(4.5);
        }
    });
});
