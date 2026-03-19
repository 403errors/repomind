import { describe, expect, it } from "vitest";
import {
    getSvgComplexityTarget,
    isVisualDiagramIntentQuery,
    resolveVisualModelPreference,
} from "@/lib/visual-intent";

describe("visual-intent", () => {
    it("detects visual diagram intent", () => {
        expect(isVisualDiagramIntentQuery("Create an animated architecture diagram")).toBe(true);
        expect(isVisualDiagramIntentQuery("Summarize this README")).toBe(false);
    });

    it("auto-promotes flash visual queries to thinking for authenticated users", () => {
        const decision = resolveVisualModelPreference("flash", "build an svg pipeline diagram", true);
        expect(decision.effectiveModelPreference).toBe("thinking");
        expect(decision.autoPromotedToThinking).toBe(true);
        expect(decision.fellBackToFlashForAnonymous).toBe(false);
    });

    it("keeps flash for anonymous visual queries", () => {
        const decision = resolveVisualModelPreference("flash", "animated flowchart please", false);
        expect(decision.effectiveModelPreference).toBe("flash");
        expect(decision.autoPromotedToThinking).toBe(false);
        expect(decision.fellBackToFlashForAnonymous).toBe(true);
    });

    it("returns complexity targets by query detail", () => {
        expect(getSvgComplexityTarget("simple diagram").tier).toBe("simple");
        expect(getSvgComplexityTarget("complex distributed architecture diagram").tier).toBe("complex");
    });
});
