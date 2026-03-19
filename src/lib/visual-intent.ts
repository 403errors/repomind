import type { ModelPreference } from "@/lib/ai-client";

const VISUAL_QUERY_PATTERN = /\b(svg|animated|animation|flowchart|architecture|diagram|pipeline)\b/i;
const COMPLEX_VISUAL_PATTERN = /\b(complex|detailed|comprehensive|end[- ]to[- ]end|distributed|microservice|event[- ]driven|orchestr|multi[- ]stage|multi[- ]step|production[- ]grade|full[- ]fledged|deep dive)\b/i;
const SIMPLE_VISUAL_PATTERN = /\b(simple|basic|minimal|quick|overview|high[- ]level|small|tiny)\b/i;

export interface SvgComplexityTarget {
    tier: "simple" | "standard" | "complex";
    minNodes: number;
    minEdges: number;
    minLanes: number;
    maxBeadsPerRoute: number;
}

export interface VisualModelRoutingDecision {
    visualIntent: boolean;
    effectiveModelPreference: ModelPreference;
    autoPromotedToThinking: boolean;
    fellBackToFlashForAnonymous: boolean;
}

export function normalizeModelPreference(value: unknown): ModelPreference {
    return value === "thinking" ? "thinking" : "flash";
}

export function isVisualDiagramIntentQuery(query: string): boolean {
    return VISUAL_QUERY_PATTERN.test(query || "");
}

export function getSvgComplexityTarget(query: string): SvgComplexityTarget {
    const normalized = (query || "").toLowerCase();

    if (COMPLEX_VISUAL_PATTERN.test(normalized)) {
        return {
            tier: "complex",
            minNodes: 9,
            minEdges: 12,
            minLanes: 3,
            maxBeadsPerRoute: 1,
        };
    }

    if (SIMPLE_VISUAL_PATTERN.test(normalized)) {
        return {
            tier: "simple",
            minNodes: 4,
            minEdges: 4,
            minLanes: 1,
            maxBeadsPerRoute: 1,
        };
    }

    return {
        tier: "standard",
        minNodes: 6,
        minEdges: 7,
        minLanes: 2,
        maxBeadsPerRoute: 1,
    };
}

export function resolveVisualModelPreference(
    requestedModelPreference: ModelPreference,
    query: string,
    canUseThinking: boolean
): VisualModelRoutingDecision {
    const visualIntent = isVisualDiagramIntentQuery(query);

    if (!visualIntent || requestedModelPreference === "thinking") {
        return {
            visualIntent,
            effectiveModelPreference: requestedModelPreference,
            autoPromotedToThinking: false,
            fellBackToFlashForAnonymous: false,
        };
    }

    if (canUseThinking) {
        return {
            visualIntent: true,
            effectiveModelPreference: "thinking",
            autoPromotedToThinking: true,
            fellBackToFlashForAnonymous: false,
        };
    }

    return {
        visualIntent: true,
        effectiveModelPreference: "flash",
        autoPromotedToThinking: false,
        fellBackToFlashForAnonymous: true,
    };
}
