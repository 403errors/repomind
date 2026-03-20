export type MermaidRenderMode = "mermaid-json" | "mermaid";

export type MermaidDiagramType =
    | "flowchart"
    | "sequenceDiagram"
    | "classDiagram"
    | "stateDiagram-v2"
    | "erDiagram"
    | "journey"
    | "gantt"
    | "pie"
    | "quadrantChart"
    | "requirementDiagram"
    | "gitGraph"
    | "C4Context"
    | "C4Container"
    | "C4Component"
    | "C4Dynamic"
    | "C4Deployment"
    | "mindmap"
    | "timeline"
    | "zenuml"
    | "sankey-beta"
    | "xychart"
    | "block-beta"
    | "packet-beta"
    | "kanban"
    | "architecture-beta"
    | "radar"
    | "treemap-beta"
    | "venn-beta";

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
}

export const MERMAID_DIAGRAM_DECLARATIONS: MermaidDiagramType[] = [
    "stateDiagram-v2",
    "requirementDiagram",
    "quadrantChart",
    "architecture-beta",
    "packet-beta",
    "sankey-beta",
    "treemap-beta",
    "venn-beta",
    "sequenceDiagram",
    "classDiagram",
    "erDiagram",
    "C4Deployment",
    "C4Context",
    "C4Container",
    "C4Component",
    "C4Dynamic",
    "mindmap",
    "timeline",
    "journey",
    "gantt",
    "gitGraph",
    "xychart",
    "block-beta",
    "kanban",
    "pie",
    "radar",
    "flowchart",
    "zenuml",
];

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

export function routeMermaidDiagram(query: string): MermaidRoute {
    const normalized = normalize(query);

    if (/\b(mind ?map|mindmap|brainstorm|brain storm)\b/i.test(normalized)) {
        return createRoute("mindmap", "mermaid-json", "mindmap", "Mind map request.");
    }

    if (/\b(sequence diagram|interaction diagram|message flow|api call flow|request response|handshake|conversation flow)\b/i.test(normalized)) {
        return createRoute("sequenceDiagram", "mermaid-json", "workflow", "Interaction or message exchange request.");
    }

    if (/\b(class diagram|object model|inheritance|oo model|uml class)\b/i.test(normalized)) {
        return createRoute("classDiagram", "mermaid-json", "model", "Object model or inheritance request.");
    }

    if (/\b(er diagram|entity relationship|schema|database schema|table relationships|relational model)\b/i.test(normalized)) {
        return createRoute("erDiagram", "mermaid-json", "model", "Relational schema request.");
    }

    if (/\b(state diagram|state machine|finite state|fsm|lifecycle|transition|status flow|state flow)\b/i.test(normalized)) {
        return createRoute("stateDiagram-v2", "mermaid-json", "state", "State or lifecycle request.");
    }

    if (/\b(journey|user journey|user flow|onboarding|funnel|ux flow|customer journey)\b/i.test(normalized)) {
        return createRoute("flowchart", "mermaid-json", "workflow", "Journey / UX flow request.");
    }

    if (/\b(roadmap|release plan|milestone|schedule|project plan|plan timeline|gantt)\b/i.test(normalized)) {
        return createRoute("gantt", "mermaid-json", "planning", "Project plan or schedule request.");
    }

    if (/\b(history|timeline|chronology|evolution|version history|changelog)\b/i.test(normalized)) {
        return createRoute("timeline", "mermaid", "timeline", "Chronological history request.");
    }

    if (/\b(pie chart|pie|breakdown|distribution|share|percentage)\b/i.test(normalized)) {
        return createRoute("pie", "mermaid", "analysis", "Part-to-whole chart request.");
    }

    if (/\b(quadrant|2x2|priority matrix|prioritization matrix|tradeoff matrix|comparison matrix)\b/i.test(normalized)) {
        return createRoute("quadrantChart", "mermaid", "comparison", "Quadrant or prioritization request.");
    }

    if (/\b(requirement|acceptance criteria|specification|constraints?|needs)\b/i.test(normalized)) {
        return createRoute("requirementDiagram", "mermaid", "analysis", "Requirement/specification request.");
    }

    if (/\b(commit graph|git graph|branches?|branching|merge history|rebase|git history)\b/i.test(normalized)) {
        return createRoute("gitGraph", "mermaid", "timeline", "Git history request.");
    }

    if (/\b(data flow|data-flow|stream|telemetry|analytics|events?|sankey|flow of data)\b/i.test(normalized)) {
        return createRoute("sankey-beta", "mermaid", "data", "Data flow / Sankey request.");
    }

    if (/\b(chart|metrics|trend|timeseries|time series|bar chart|line chart|visualize data|plot data)\b/i.test(normalized)) {
        return createRoute("xychart", "mermaid", "analysis", "Metric or trend chart request.");
    }

    if (/\b(block diagram|blocks?|components? layout|system blocks|layer diagram|tier diagram)\b/i.test(normalized)) {
        return createRoute("block-beta", "mermaid", "architecture", "Block or layered architecture request.");
    }

    if (/\b(packet|protocol|network packet|payload)\b/i.test(normalized)) {
        return createRoute("packet-beta", "mermaid", "data", "Packet or protocol request.");
    }

    if (/\b(kanban|board|to-do|todo|in progress|done|backlog)\b/i.test(normalized)) {
        return createRoute("kanban", "mermaid", "board", "Kanban board request.");
    }

    if (/\b(radar|scorecard|criteria map|capability map|capability radar)\b/i.test(normalized)) {
        return createRoute("radar", "mermaid", "analysis", "Radar comparison request.");
    }

    if (/\b(tree map|treemap|hierarchy size|folder size|distribution tree)\b/i.test(normalized)) {
        return createRoute("treemap-beta", "mermaid", "analysis", "Hierarchical size request.");
    }

    if (/\b(venn|overlap|intersection|set comparison)\b/i.test(normalized)) {
        return createRoute("venn-beta", "mermaid", "analysis", "Set overlap request.");
    }

    if (/\b(zenuml|sequence map)\b/i.test(normalized)) {
        return createRoute("zenuml", "mermaid", "workflow", "ZenUML request.");
    }

    if (/\b(c4|system context|context diagram)\b/i.test(normalized)) {
        return createRoute("C4Context", "mermaid", "architecture", "System context / C4 overview request.");
    }

    if (/\b(deployment diagram|deployment|deploy|infra|infrastructure|cluster|kubernetes|runtime topology)\b/i.test(normalized)) {
        return createRoute("C4Deployment", "mermaid", "architecture", "Deployment or infrastructure request.");
    }

    if (/\b(component diagram|component architecture|module architecture|internal component)\b/i.test(normalized)) {
        return createRoute("C4Component", "mermaid", "architecture", "Component-level architecture request.");
    }

    if (/\b(dynamic flow|runtime flow|runtime interaction|live request flow|runtime diagram)\b/i.test(normalized)) {
        return createRoute("C4Dynamic", "mermaid", "architecture", "Runtime interaction request.");
    }

    if (/\b(architecture diagram|system architecture|application architecture|app architecture|platform architecture|architecture overview|architecture)\b/i.test(normalized)) {
        return createRoute("flowchart", "mermaid-json", "architecture", "General architecture request.");
    }

    if (/\b(container diagram|service architecture|microservice|service map|system architecture|app architecture|platform architecture)\b/i.test(normalized)) {
        return createRoute("flowchart", "mermaid-json", "architecture", "Container/service architecture request.");
    }

    if (/\b(architecture beta|architecture-beta|architecture block|service diagram|system layout|layered architecture|layered system)\b/i.test(normalized)) {
        return createRoute("flowchart", "mermaid-json", "architecture", "Architecture block request.");
    }

    if (/\b(flowchart|flow chart|workflow|pipeline|process flow|decision flow|task flow)\b/i.test(normalized)) {
        return createRoute("flowchart", "mermaid-json", "workflow", "Explicit flowchart or workflow request.");
    }

    return createRoute("flowchart", "mermaid-json", "default", "No diagram intent detected; text-only fallback.", false);
}

export function isMermaidDiagramDeclaration(value: string): value is MermaidDiagramType {
    return MERMAID_DIAGRAM_DECLARATIONS.includes(value as MermaidDiagramType);
}
