import { describe, expect, it } from "vitest";
import { getSvgComplexityTarget } from "@/lib/visual-intent";
import { validateAnimatedSvgMarkdown } from "@/lib/svg-quality";

function buildAnimatedSvgFixture(nodeCount: number, beadRouteCoverageCount = nodeCount - 1): string {
    const nodes = Array.from({ length: nodeCount }, (_, index) => `  <g class="node" id="node-${index}"></g>`).join("\n");
    const lanes = [
        '  <g class="lane lane-1"></g>',
        '  <g class="lane lane-2"></g>',
        '  <g class="lane lane-3"></g>',
    ].join("\n");
    const edges = Array.from({ length: nodeCount - 1 }, (_, index) => `  <path class="edge" id="route-${index}-${index + 1}" d="M${index} ${index} L${index + 1} ${index + 1}" />`).join("\n");
    const beads = Array.from({ length: nodeCount - 1 }, (_, index) => {
        const routeIndex = index < beadRouteCoverageCount ? index : 0;
        return `  <circle class="bead" r="4"><animateMotion dur="2s" repeatCount="indefinite"><mpath href="#route-${routeIndex}-${routeIndex + 1}"/></animateMotion></circle>`;
    }).join("\n");

    return `
\`\`\`svg
<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">
  <text class="title" x="400" y="32" text-anchor="middle">Dense Visual</text>
${lanes}
${nodes}
${edges}
${beads}
  <g class="legend"><text>Legend</text></g>
</svg>
\`\`\`
`;
}

describe("svg-quality", () => {
    it("passes a structurally valid animated svg response", () => {
        const target = getSvgComplexityTarget("simple animated pipeline diagram");
        const result = validateAnimatedSvgMarkdown(buildAnimatedSvgFixture(6), target);
        expect(result.ok).toBe(true);
    });

    it("passes a 15-20 node dense diagram", () => {
        const target = getSvgComplexityTarget("complex architecture diagram");
        const result = validateAnimatedSvgMarkdown(buildAnimatedSvgFixture(18), target);
        expect(result.ok).toBe(true);
    });

    it("passes a 50-node max-density diagram", () => {
        const target = getSvgComplexityTarget("complex architecture diagram");
        const result = validateAnimatedSvgMarkdown(buildAnimatedSvgFixture(50), target);
        expect(result.ok).toBe(true);
    });

    it("fails when a route is missing bead coverage", () => {
        const target = getSvgComplexityTarget("complex architecture diagram");
        const result = validateAnimatedSvgMarkdown(buildAnimatedSvgFixture(6, 4), target);
        expect(result.ok).toBe(false);
        expect(result.failures.join(" ")).toContain("Every route must be covered");
    });

    it("fails when svg block is missing", () => {
        const target = getSvgComplexityTarget("animated architecture diagram");
        const result = validateAnimatedSvgMarkdown("No svg here", target);
        expect(result.ok).toBe(false);
        expect(result.failures[0]).toContain("Missing ```svg```");
    });
});
