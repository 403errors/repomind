import { describe, expect, it } from "vitest";
import {
    getSvgComplexityTarget,
    getVisualDiagramProfile,
    isVisualDiagramIntentQuery,
    resolveVisualModelPreference,
} from "@/lib/visual-intent";

describe("visual-intent", () => {
    it("detects visual diagram intent", () => {
        expect(isVisualDiagramIntentQuery("Create an animated architecture diagram")).toBe(true);
        expect(isVisualDiagramIntentQuery("Create a mindmap of the repo")).toBe(true);
        expect(isVisualDiagramIntentQuery("Summarize this README")).toBe(false);
        expect(isVisualDiagramIntentQuery("Draw a diagram")).toBe(false);
    });

    it("auto-promotes flash visual queries to thinking for authenticated users", () => {
        const decision = resolveVisualModelPreference("flash", "build an svg pipeline diagram", true);
        expect(decision.effectiveModelPreference).toBe("thinking");
        expect(decision.autoPromotedToThinking).toBe(true);
        expect(decision.fellBackToFlashForAnonymous).toBe(false);
    });

    it("falls back to flash for anonymous visual requests", () => {
        const decision = resolveVisualModelPreference("flash", "animated flowchart please", false);
        expect(decision.effectiveModelPreference).toBe("flash");
        expect(decision.autoPromotedToThinking).toBe(false);
        expect(decision.fellBackToFlashForAnonymous).toBe(true);
        expect(decision.visualIntent).toBe(true);
    });

    it("returns complexity targets by query detail", () => {
        expect(getSvgComplexityTarget("simple diagram").tier).toBe("simple");
        expect(getSvgComplexityTarget("simple diagram").minNodes).toBe(6);
        expect(getSvgComplexityTarget("complex distributed architecture diagram").tier).toBe("complex");
        expect(getSvgComplexityTarget("complex distributed architecture diagram").minNodes).toBe(15);
        expect(getSvgComplexityTarget("complex distributed architecture diagram").maxNodes).toBe(50);
    });

    it("routes visuals to the right diagram family", () => {
        expect(getVisualDiagramProfile("animated architecture system diagram").family).toBe("architecture");
        expect(getVisualDiagramProfile("pipeline workflow with stages").family).toBe("pipeline");
        expect(getVisualDiagramProfile("state lifecycle transition map").family).toBe("state");
        expect(getVisualDiagramProfile("timeline of releases").preferredMermaidDiagram).toBe("gantt");
        expect(getVisualDiagramProfile("animated architecture system diagram").preferredNodeRange).toEqual([15, 20]);
    });
});
