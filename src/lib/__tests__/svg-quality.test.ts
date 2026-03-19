import { describe, expect, it } from "vitest";
import { getSvgComplexityTarget } from "@/lib/visual-intent";
import { validateAnimatedSvgMarkdown } from "@/lib/svg-quality";

describe("svg-quality", () => {
    it("passes a structurally valid animated svg response", () => {
        const markdown = `
\`\`\`svg
<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">
  <text class="title" x="400" y="32" text-anchor="middle">Simple Pipeline</text>
  <g class="lane lane-1"></g>
  <g class="node" id="node-a"></g>
  <g class="node" id="node-b"></g>
  <g class="node" id="node-c"></g>
  <g class="node" id="node-d"></g>
  <path class="edge" id="route-a-b" d="M120 120 L260 120" />
  <path class="edge" id="route-b-c" d="M280 120 L420 120" />
  <path class="edge" id="route-c-d" d="M440 120 L580 120" />
  <path class="edge" id="route-d-a" d="M580 140 L120 140" />
  <circle class="bead" r="4">
    <animateMotion dur="2s" repeatCount="indefinite"><mpath href="#route-a-b"/></animateMotion>
  </circle>
  <circle class="bead" r="4">
    <animateMotion dur="2s" repeatCount="indefinite"><mpath href="#route-b-c"/></animateMotion>
  </circle>
  <circle class="bead" r="4">
    <animateMotion dur="2s" repeatCount="indefinite"><mpath href="#route-c-d"/></animateMotion>
  </circle>
  <circle class="bead" r="4">
    <animateMotion dur="2s" repeatCount="indefinite"><mpath href="#route-d-a"/></animateMotion>
  </circle>
  <g class="legend"><text>Legend</text></g>
</svg>
\`\`\`
`;

        const target = getSvgComplexityTarget("simple animated pipeline diagram");
        const result = validateAnimatedSvgMarkdown(markdown, target);
        expect(result.ok).toBe(true);
    });

    it("fails when svg block is missing", () => {
        const target = getSvgComplexityTarget("animated architecture diagram");
        const result = validateAnimatedSvgMarkdown("No svg here", target);
        expect(result.ok).toBe(false);
        expect(result.failures[0]).toContain("Missing ```svg```");
    });
});
