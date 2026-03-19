import type { ModelPreference } from "@/lib/ai-client";

const VISUAL_QUERY_PATTERN = /\b(svg|animated|animation|flowchart|architecture|diagram|pipeline)\b/i;
const COMPLEX_VISUAL_PATTERN = /\b(complex|detailed|comprehensive|end[- ]to[- ]end|distributed|microservice|event[- ]driven|orchestr|multi[- ]stage|multi[- ]step|production[- ]grade|full[- ]fledged|deep dive)\b/i;
const SIMPLE_VISUAL_PATTERN = /\b(simple|basic|minimal|quick|overview|high[- ]level|small|tiny)\b/i;
const MIN_VISUAL_NODE_COUNT = 6;

export type VisualDiagramFamily =
    | "architecture"
    | "pipeline"
    | "state"
    | "timeline"
    | "comparison"
    | "data-flow"
    | "journey"
    | "default";

export type VisualDiagramFormat = "svg" | "mermaid";
export type PreferredMermaidDiagram = "flowchart" | "stateDiagram-v2" | "gantt" | "sequenceDiagram";

export interface VisualDiagramProfile {
    family: VisualDiagramFamily;
    preferredFormat: VisualDiagramFormat;
    preferredMermaidDiagram?: PreferredMermaidDiagram;
    preferredNodeRange: [number, number];
    animationFocus: string;
    layoutFocus: string;
}

export interface SvgComplexityTarget {
    tier: "simple" | "standard" | "complex";
    minNodes: number;
    minEdges: number;
    minLanes: number;
    maxBeadsPerRoute: number;
    preferredNodeRange: [number, number];
    maxNodes: number;
}

export interface VisualModelRoutingDecision {
    visualIntent: boolean;
    effectiveModelPreference: ModelPreference;
    autoPromotedToThinking: boolean;
    fellBackToFlashForAnonymous: boolean;
    visualFamily: VisualDiagramFamily;
    preferredVisualFormat: VisualDiagramFormat;
    preferredMermaidDiagram?: PreferredMermaidDiagram;
}

export function normalizeModelPreference(value: unknown): ModelPreference {
    return value === "thinking" ? "thinking" : "flash";
}

export function isVisualDiagramIntentQuery(query: string): boolean {
    return VISUAL_QUERY_PATTERN.test(query || "");
}

export function getVisualDiagramProfile(query: string): VisualDiagramProfile {
    const normalized = (query || "").toLowerCase();

    if (/\b(state|lifecycle|transition|fsm|finite state|status|mode)\b/i.test(normalized)) {
        return {
            family: "state",
            preferredFormat: "mermaid",
            preferredMermaidDiagram: "stateDiagram-v2",
            preferredNodeRange: [10, 16],
            animationFocus: "Active state glow, guarded transitions, and transition sweeps.",
            layoutFocus: "Use a clean left-to-right state map with clearly labeled entry, active, and terminal states.",
        };
    }

    if (/\b(timeline|history|sequence|roadmap|milestone|release|changelog|version)\b/i.test(normalized)) {
        return {
            family: "timeline",
            preferredFormat: "mermaid",
            preferredMermaidDiagram: "gantt",
            preferredNodeRange: [10, 16],
            animationFocus: "Milestone reveal, progress sweep, and date markers.",
            layoutFocus: "Show events in chronological order with visible timing and milestone annotations.",
        };
    }

    if (/\b(comparison|tradeoff|versus|vs\.?|pros|cons|matrix|options|evaluate)\b/i.test(normalized)) {
        return {
            family: "comparison",
            preferredFormat: "svg",
            preferredNodeRange: [10, 16],
            animationFocus: "Column-by-column reveal and subtle emphasis on the recommended option.",
            layoutFocus: "Use side-by-side panes, badges, and comparison markers.",
        };
    }

    if (/\b(data flow|data-flow|analytics|sankey|stream|event|telemetry|metrics|dashboard)\b/i.test(normalized)) {
        return {
            family: "data-flow",
            preferredFormat: "svg",
            preferredMermaidDiagram: "flowchart",
            preferredNodeRange: [15, 20],
            animationFocus: "One primary stream bead plus supporting sink/source pulses.",
            layoutFocus: "Use weighted routes, pipeline lanes, and visible sinks/sources.",
        };
    }

    if (/\b(journey|ux|user flow|onboarding|funnel|experience|screen|journey map|customer)\b/i.test(normalized)) {
        return {
            family: "journey",
            preferredFormat: "svg",
            preferredMermaidDiagram: "flowchart",
            preferredNodeRange: [15, 20],
            animationFocus: "Step-by-step reveal with a guided path and decision highlights.",
            layoutFocus: "Show screens or steps as a clear user journey with branches and outcomes.",
        };
    }

    if (/\b(pipeline|workflow|process|flow|build|deploy|ci|cd|etl|task|job)\b/i.test(normalized)) {
        return {
            family: "pipeline",
            preferredFormat: "svg",
            preferredMermaidDiagram: "flowchart",
            preferredNodeRange: [15, 20],
            animationFocus: "Primary route bead, stage pulses, and branch emphasis.",
            layoutFocus: "Use stages, handoffs, loops, and a visible critical path.",
        };
    }

    if (/\b(architecture|system|service|services|microservice|component|module|layer|layers|infrastructure|platform)\b/i.test(normalized)) {
        return {
            family: "architecture",
            preferredFormat: "svg",
            preferredMermaidDiagram: "flowchart",
            preferredNodeRange: [15, 20],
            animationFocus: "Service pulses, connector tracing, and cross-layer focus.",
            layoutFocus: "Build stacked layers with service clusters, data routes, and a title plus legend.",
        };
    }

    return {
        family: "default",
        preferredFormat: "svg",
        preferredMermaidDiagram: "flowchart",
        preferredNodeRange: [12, 18],
        animationFocus: "Subtle route tracing and node reveal.",
        layoutFocus: "Use a balanced diagram with a readable title, legend, and supporting labels.",
    };
}

export function getSvgComplexityTarget(query: string): SvgComplexityTarget {
    const normalized = (query || "").toLowerCase();
    const profile = getVisualDiagramProfile(normalized);

    if (COMPLEX_VISUAL_PATTERN.test(normalized)) {
        return {
            tier: "complex",
            minNodes: 15,
            minEdges: 15,
            minLanes: 3,
            maxBeadsPerRoute: 2,
            preferredNodeRange: [15, 20],
            maxNodes: 50,
        };
    }

    if (SIMPLE_VISUAL_PATTERN.test(normalized)) {
        return {
            tier: "simple",
            minNodes: MIN_VISUAL_NODE_COUNT,
            minEdges: 4,
            minLanes: 1,
            maxBeadsPerRoute: 2,
            preferredNodeRange: profile.preferredNodeRange,
            maxNodes: 50,
        };
    }

    return {
        tier: "standard",
        minNodes: 12,
        minEdges: 10,
        minLanes: 2,
        maxBeadsPerRoute: 2,
        preferredNodeRange: profile.preferredNodeRange,
        maxNodes: 50,
    };
}

export function resolveVisualModelPreference(
    requestedModelPreference: ModelPreference,
    query: string,
    canUseThinking: boolean
): VisualModelRoutingDecision {
    const visualIntent = isVisualDiagramIntentQuery(query);
    const profile = getVisualDiagramProfile(query);

    if (!visualIntent || requestedModelPreference === "thinking") {
        return {
            visualIntent,
            effectiveModelPreference: requestedModelPreference,
            autoPromotedToThinking: false,
            fellBackToFlashForAnonymous: false,
            visualFamily: profile.family,
            preferredVisualFormat: profile.preferredFormat,
            preferredMermaidDiagram: profile.preferredMermaidDiagram,
        };
    }

    if (canUseThinking) {
        return {
            visualIntent: true,
            effectiveModelPreference: "thinking",
            autoPromotedToThinking: true,
            fellBackToFlashForAnonymous: false,
            visualFamily: profile.family,
            preferredVisualFormat: profile.preferredFormat,
            preferredMermaidDiagram: profile.preferredMermaidDiagram,
        };
    }

    return {
        visualIntent: true,
        effectiveModelPreference: "flash",
        autoPromotedToThinking: false,
        fellBackToFlashForAnonymous: true,
        visualFamily: profile.family,
        preferredVisualFormat: profile.preferredFormat,
        preferredMermaidDiagram: profile.preferredMermaidDiagram,
    };
}
