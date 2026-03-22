export type MermaidRenderMode = "mermaid-json" | "mermaid";

export type MermaidDiagramType =
    | "flowchart"
    | "sequenceDiagram"
    | "classDiagram"
    | "stateDiagram-v2"
    | "erDiagram"
    | "gantt"
    | "mindmap"
    | "xychart";

export interface MermaidRoute {
    diagramType: MermaidDiagramType;
    renderMode: MermaidRenderMode;
    family:
        | "architecture"
        | "workflow"
        | "state"
        | "timeline"
        | "comparison"
        | "data"
        | "model"
        | "planning"
        | "analysis"
        | "board"
        | "mindmap"
        | "default";
    visualIntent: boolean;
    reason: string;
    multipleVisualsRequested?: boolean;
    secondaryDiagramType?: MermaidDiagramType;
}

export const MERMAID_DIAGRAM_DECLARATIONS: MermaidDiagramType[] = [
    "stateDiagram-v2",
    "sequenceDiagram",
    "classDiagram",
    "erDiagram",
    "mindmap",
    "gantt",
    "xychart",
    "flowchart",
];

type RouteFamily = MermaidRoute["family"];

const TYPE_PRIORITY: MermaidDiagramType[] = [
    "flowchart",
    "sequenceDiagram",
    "stateDiagram-v2",
    "classDiagram",
    "erDiagram",
    "mindmap",
    "gantt",
    "xychart",
];

const TYPE_FAMILY_MAP: Record<MermaidDiagramType, RouteFamily> = {
    flowchart: "workflow",
    sequenceDiagram: "workflow",
    "stateDiagram-v2": "state",
    classDiagram: "model",
    erDiagram: "model",
    mindmap: "mindmap",
    gantt: "planning",
    xychart: "analysis",
};

const TYPE_DEFAULT_REASON: Record<MermaidDiagramType, string> = {
    flowchart: "Workflow/architecture intent detected.",
    sequenceDiagram: "Interaction/message-flow intent detected.",
    "stateDiagram-v2": "State/lifecycle intent detected.",
    classDiagram: "Class/object-model intent detected.",
    erDiagram: "Entity-relationship/schema intent detected.",
    mindmap: "Mindmap/brainstorm intent detected.",
    gantt: "Timeline/planning intent detected.",
    xychart: "Metrics/trend chart intent detected.",
};

interface DiagramSignal {
    diagramType: MermaidDiagramType;
    family?: RouteFamily;
    pattern: RegExp;
    weight: number;
    reason: string;
}

const DIAGRAM_SIGNALS: DiagramSignal[] = [
    { diagramType: "flowchart", family: "workflow", pattern: /\bflowchart\b/i, weight: 10, reason: "Explicit flowchart mention." },
    { diagramType: "flowchart", family: "workflow", pattern: /\b(workflow|pipeline|process flow|decision flow|task flow)\b/i, weight: 7, reason: "Workflow/pipeline terms." },
    { diagramType: "flowchart", family: "architecture", pattern: /\b(architecture diagram|system architecture|application architecture|app architecture|platform architecture|service architecture|microservice|service map|layered architecture|container diagram)\b/i, weight: 6, reason: "Architecture/service-map terms." },
    { diagramType: "flowchart", family: "workflow", pattern: /\b(journey|user journey|user flow|onboarding|funnel|ux flow|customer journey)\b/i, weight: 6, reason: "Journey/funnel terms remapped to flowchart." },
    { diagramType: "flowchart", family: "workflow", pattern: /\b(commit graph|git graph|branches?|branching|merge history|rebase|git history)\b/i, weight: 10, reason: "Git-history terms remapped to flowchart." },

    { diagramType: "sequenceDiagram", family: "workflow", pattern: /\bsequence(?:\s+diagram)?\b/i, weight: 10, reason: "Explicit sequence-diagram mention." },
    { diagramType: "sequenceDiagram", family: "workflow", pattern: /\b(interaction diagram|message flow|api call flow|request response|handshake|conversation flow)\b/i, weight: 8, reason: "Interaction/message-flow terms." },

    { diagramType: "stateDiagram-v2", family: "state", pattern: /\bstate(?:\s+diagram)?(?:-v2)?\b/i, weight: 10, reason: "Explicit state-diagram mention." },
    { diagramType: "stateDiagram-v2", family: "state", pattern: /\b(state machine|finite state|fsm|lifecycle|transition|status flow|state flow)\b/i, weight: 8, reason: "State/lifecycle terms." },

    { diagramType: "classDiagram", family: "model", pattern: /\bclass(?:\s+diagram)?\b/i, weight: 10, reason: "Explicit class-diagram mention." },
    { diagramType: "classDiagram", family: "model", pattern: /\b(object model|inheritance|oo model|uml class)\b/i, weight: 8, reason: "Object-model/UML terms." },

    { diagramType: "erDiagram", family: "model", pattern: /\ber(?:\s+diagram)?\b/i, weight: 10, reason: "Explicit ER-diagram mention." },
    { diagramType: "erDiagram", family: "model", pattern: /\b(entity relationship|database schema|table relationships|relational model)\b/i, weight: 8, reason: "Relational-schema terms." },

    { diagramType: "mindmap", family: "mindmap", pattern: /\bmind ?map|mindmap|brainstorm|brain storm\b/i, weight: 10, reason: "Mindmap/brainstorm terms." },

    { diagramType: "gantt", family: "planning", pattern: /\bgantt\b/i, weight: 10, reason: "Explicit gantt mention." },
    { diagramType: "gantt", family: "planning", pattern: /\b(roadmap|release plan|milestone|schedule|project plan|plan timeline)\b/i, weight: 8, reason: "Planning timeline terms." },
    { diagramType: "gantt", family: "planning", pattern: /\b(history|timeline|chronology|evolution|version history|changelog)\b/i, weight: 7, reason: "Timeline/history terms remapped to gantt." },

    { diagramType: "xychart", family: "analysis", pattern: /\bxychart(?:-beta)?\b/i, weight: 10, reason: "Explicit xychart mention." },
    { diagramType: "xychart", family: "analysis", pattern: /\b(chart|metrics|trend|timeseries|time series|bar chart|line chart|visualize data|plot data)\b/i, weight: 7, reason: "Chart/metrics terms." },
];

const EXPLICIT_MULTI_VISUAL_PATTERN =
    /\b((two|2)\s+(separate\s+)?(diagrams?|visuals?|charts?)|multiple\s+(diagrams?|visuals?|charts?)|both\s+.*\b(diagrams?|visuals?|charts?)|one\s+.*\b(diagram|visual|chart)\b.*\b(and|then)\b.*\b(another|second)\s+(diagram|visual|chart))\b/i;

const MIN_PRIMARY_SCORE_FOR_VISUAL = 6;

function normalize(query: string): string {
    return (query || "").toLowerCase();
}

function createRoute(
    diagramType: MermaidDiagramType,
    renderMode: MermaidRenderMode,
    family: MermaidRoute["family"],
    reason: string,
    visualIntent = true
): MermaidRoute {
    return {
        diagramType,
        renderMode,
        family,
        visualIntent,
        reason,
    };
}

function sortDiagramTypesByScore(scores: Record<MermaidDiagramType, number>): MermaidDiagramType[] {
    return [...TYPE_PRIORITY].sort((a, b) => {
        const scoreDiff = scores[b] - scores[a];
        if (scoreDiff !== 0) return scoreDiff;
        return TYPE_PRIORITY.indexOf(a) - TYPE_PRIORITY.indexOf(b);
    });
}

export function routeMermaidDiagram(query: string): MermaidRoute {
    const normalized = normalize(query);
    const scores: Record<MermaidDiagramType, number> = {
        flowchart: 0,
        sequenceDiagram: 0,
        "stateDiagram-v2": 0,
        classDiagram: 0,
        erDiagram: 0,
        mindmap: 0,
        gantt: 0,
        xychart: 0,
    };
    const reasons: Record<MermaidDiagramType, string[]> = {
        flowchart: [],
        sequenceDiagram: [],
        "stateDiagram-v2": [],
        classDiagram: [],
        erDiagram: [],
        mindmap: [],
        gantt: [],
        xychart: [],
    };
    const familyScores: Record<RouteFamily, number> = {
        architecture: 0,
        workflow: 0,
        state: 0,
        timeline: 0,
        comparison: 0,
        data: 0,
        model: 0,
        planning: 0,
        analysis: 0,
        board: 0,
        mindmap: 0,
        default: 0,
    };

    for (const signal of DIAGRAM_SIGNALS) {
        if (signal.pattern.test(normalized)) {
            scores[signal.diagramType] += signal.weight;
            reasons[signal.diagramType].push(signal.reason);
            if (signal.family) {
                familyScores[signal.family] += signal.weight;
            }
        }
    }

    const sortedTypes = sortDiagramTypesByScore(scores);
    const primaryType = sortedTypes[0];
    const primaryScore = scores[primaryType];

    if (primaryScore < MIN_PRIMARY_SCORE_FOR_VISUAL) {
        return createRoute("flowchart", "mermaid-json", "default", "No clear visual intent detected; text-first fallback.", false);
    }

    const family =
        primaryType === "flowchart"
            ? (familyScores.architecture > familyScores.workflow ? "architecture" : "workflow")
            : TYPE_FAMILY_MAP[primaryType];

    const route = createRoute(
        primaryType,
        "mermaid-json",
        family,
        reasons[primaryType][0] ?? TYPE_DEFAULT_REASON[primaryType],
        true
    );

    const multipleExplicit = EXPLICIT_MULTI_VISUAL_PATTERN.test(normalized);
    if (!multipleExplicit) {
        return route;
    }

    const secondaryType = sortedTypes.find((type) => type !== primaryType && scores[type] >= MIN_PRIMARY_SCORE_FOR_VISUAL);
    if (!secondaryType) {
        return route;
    }

    return {
        ...route,
        multipleVisualsRequested: true,
        secondaryDiagramType: secondaryType,
        reason: `${route.reason} Explicit multi-visual request detected.`,
    };
}

export function isMermaidDiagramDeclaration(value: string): value is MermaidDiagramType {
    return MERMAID_DIAGRAM_DECLARATIONS.includes(value as MermaidDiagramType);
}
