/**
 * Fallback diagram templates for when AI generation fails
 */

import { MERMAID_DIAGRAM_DECLARATIONS } from "./mermaid-router";

export const templates = {
    /**
     * Basic linear flow diagram
     */
    basicFlow: (components: string[]) => {
        const sanitized = components.map(c =>
            c.replace(/["'`<>]/g, '')
                .replace(/[\\\/]/g, ' ')
                .replace(/[^a-zA-Z0-9 .,;:!?()\_-]/g, '')
                .trim()
        ).filter(c => c.length > 0);

        const defaults = ['Start', 'Validate', 'Plan', 'Execute', 'Review', 'End'];
        for (const label of defaults) {
            if (sanitized.length >= 6) break;
            if (!sanitized.includes(label)) {
                sanitized.push(label);
            }
        }

        while (sanitized.length < 6) {
            sanitized.push(`Step ${sanitized.length + 1}`);
        }

        return `graph TD
${sanitized.map((c, i) => `  N${i}["${c}"]`).join('\n')}
${sanitized.slice(0, -1).map((_, i) => `  N${i} --> N${i + 1}`).join('\n')}`;
    },

    /**
     * Layered architecture diagram
     */
    layeredArch: (layers: string[]) => {
        const clean = (s: string) => s.replace(/["'`<>]/g, '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
        return `graph TB
  subgraph Frontend
    UI["${clean(layers[0] || 'User Interface')}"]
    Shell["${clean(layers[1] || 'App Shell')}"]
  end
  subgraph Backend
    API["${clean(layers[2] || 'API Layer')}"]
    Worker["${clean(layers[3] || 'Worker Layer')}"]
  end
  subgraph Data
    Cache["${clean(layers[4] || 'Cache Layer')}"]
    DB["${clean(layers[5] || 'Database')}"]
  end
  UI --> Shell
  Shell --> API
  API --> Worker
  Worker --> Cache
  Cache --> DB`;
    },

    /**
     * Component dependency diagram
     */
    componentDiagram: (components: Array<{ name: string; deps?: string[] }>) => {
        const fallbackNames = ['Component A', 'Component B', 'Component C', 'Component D', 'Component E', 'Component F'];
        const normalized = components.slice(0, 6).map((component, index) => ({
            name: component.name || fallbackNames[index],
            deps: component.deps ?? (index < 5 ? [fallbackNames[index + 1]] : []),
        }));

        while (normalized.length < 6) {
            const index = normalized.length;
            normalized.push({
                name: fallbackNames[index],
                deps: index < 5 ? [fallbackNames[index + 1]] : [],
            });
        }

        return `
graph LR
${normalized.map(c => `  ${c.name.replace(/[^a-zA-Z0-9]/g, '_')}["${c.name}"]`).join('\n')}
${normalized.flatMap(c =>
            (c.deps || []).map(d => `  ${c.name.replace(/[^a-zA-Z0-9]/g, '_')} --> ${d.replace(/[^a-zA-Z0-9]/g, '_')}`)
        ).join('\n')}
  `;
    },

    /**
     * Service architecture diagram
     */
    serviceArch: () => `
graph TB
  Client["Client/Browser"]
  LB["Load Balancer"]
  App1["App Server 1"]
  App2["App Server 2"]
  Cache["Redis Cache"]
  DB["Database"]
  
  Client --> LB
  LB --> App1
  LB --> App2
  App1 --> Cache
  App2 --> Cache
  App1 --> DB
  App2 --> DB
  `,
};

const MIN_FLOWCHART_NODE_COUNT = 6;
const VALID_MERMAID_DIAGRAM_TYPES = ["graph", ...MERMAID_DIAGRAM_DECLARATIONS];

export function countMermaidFlowchartNodes(code: string): number {
    const nodeIds = new Set<string>();
    const lines = code.split("\n");

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("graph ") || line.startsWith("flowchart ") || line.startsWith("subgraph ") || line === "end") {
            continue;
        }

        const explicitNodePattern = /\b([A-Za-z0-9_-]+)\s*(\[\s*"(?:[^"\\]|\\.)*"\s*\]|\(\s*"(?:[^"\\]|\\.)*"\s*\)|\(\(\s*"(?:[^"\\]|\\.)*"\s*\)\)|\{\s*"(?:[^"\\]|\\.)*"\s*\}|\[\(\s*"(?:[^"\\]|\\.)*"\s*\)\]|\{\{\s*"(?:[^"\\]|\\.)*"\s*\}\})/g;
        for (const match of line.matchAll(explicitNodePattern)) {
            nodeIds.add(match[1]);
        }

        const edgePattern = /\b([A-Za-z0-9_-]+)\b\s*(?:-->|-.->|==>|---)\s*(?:\|[^|]*\|\s*)?\b([A-Za-z0-9_-]+)\b/g;
        for (const match of line.matchAll(edgePattern)) {
            nodeIds.add(match[1]);
            nodeIds.add(match[2]);
        }
    }

    return nodeIds.size;
}

function getFirstMermaidNodeId(code: string): string | null {
    const lines = code.split("\n");
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("graph ") || line.startsWith("flowchart ") || line.startsWith("subgraph ") || line === "end") {
            continue;
        }

        const explicitNodePattern = /\b([A-Za-z0-9_-]+)\s*(?:\[\s*"(?:[^"\\]|\\.)*"\s*\]|\(\s*"(?:[^"\\]|\\.)*"\s*\)|\(\(\s*"(?:[^"\\]|\\.)*"\s*\)\)|\{\s*"(?:[^"\\]|\\.)*"\s*\}|\[\(\s*"(?:[^"\\]|\\.)*"\s*\)\]|\{\{\s*"(?:[^"\\]|\\.)*"\s*\}\})/;
        const match = line.match(explicitNodePattern);
        if (match?.[1]) {
            return match[1];
        }

        const edgePattern = /\b([A-Za-z0-9_-]+)\b\s*(?:-->|-.->|==>|---)\s*(?:\|[^|]*\|\s*)?\b([A-Za-z0-9_-]+)\b/;
        const edgeMatch = line.match(edgePattern);
        if (edgeMatch?.[1]) {
            return edgeMatch[1];
        }
    }

    return null;
}

function getMermaidExpansionLabels(context?: string): string[] {
    const normalized = (context ?? "").toLowerCase();

    if (/\b(architecture|system|service|services|microservice|layer|platform|infrastructure)\b/i.test(normalized)) {
        return ["Gateway", "Auth", "Cache", "Worker", "Storage", "Observability"];
    }

    if (/\b(pipeline|workflow|process|build|deploy|etl|ci|cd|task|job)\b/i.test(normalized)) {
        return ["Trigger", "Plan", "Run", "Check", "Ship", "Feedback"];
    }

    if (/\b(state|lifecycle|transition|status|mode|fsm)\b/i.test(normalized)) {
        return ["Idle", "Pending", "Active", "Review", "Error", "Done"];
    }

    if (/\b(timeline|history|milestone|release|version|sequence)\b/i.test(normalized)) {
        return ["Kickoff", "Milestone 1", "Milestone 2", "Milestone 3", "Milestone 4", "Close"];
    }

    if (/\b(comparison|tradeoff|versus|vs\.?|matrix|options|evaluate)\b/i.test(normalized)) {
        return ["Option A", "Option B", "Criteria", "Score", "Recommendation", "Decision"];
    }

    if (/\b(data flow|data-flow|analytics|stream|event|telemetry|metrics|dashboard)\b/i.test(normalized)) {
        return ["Source", "Normalize", "Enrich", "Aggregate", "Visualize", "Store"];
    }

    if (/\b(journey|ux|user flow|onboarding|funnel|experience|screen|customer)\b/i.test(normalized)) {
        return ["Entry", "Browse", "Decision", "Action", "Success", "Exit"];
    }

    return ["Context", "Rules", "Inputs", "Transform", "Validation", "Output"];
}

export function ensureMermaidMinimumDetail(code: string, context?: string, minimumNodes = MIN_FLOWCHART_NODE_COUNT): string {
    const trimmed = code.trim();
    const diagramType = extractDiagramType(trimmed);
    if (diagramType !== "graph" && diagramType !== "flowchart") {
        return code;
    }

    const nodeCount = countMermaidFlowchartNodes(trimmed);
    if (nodeCount >= minimumNodes) {
        return code;
    }

    const extraLabels = getMermaidExpansionLabels(context ?? trimmed).slice(0, Math.max(0, minimumNodes - nodeCount));
    const existingIds = new Set(
        Array.from(
            trimmed.matchAll(/\b([A-Za-z0-9_-]+)\s*(?:\[\s*"(?:[^"\\]|\\.)*"\s*\]|\(\s*"(?:[^"\\]|\\.)*"\s*\)|\(\(\s*"(?:[^"\\]|\\.)*"\s*\)\)|\{\s*"(?:[^"\\]|\\.)*"\s*\}|\[\(\s*"(?:[^"\\]|\\.)*"\s*\)\]|\{\{\s*"(?:[^"\\]|\\.)*"\s*\}\})/g),
            (match) => match[1]
        )
    );
    const generatedIds = extraLabels.map((_, idx) => `detail_${idx + 1}`).filter((id) => !existingIds.has(id));
    const anchorId = getFirstMermaidNodeId(trimmed) ?? "Start";
    const detailLines = generatedIds.map((id, index) => `  ${id}["${extraLabels[index]}"]`);
    const detailEdges = generatedIds.map((id, index) => index === 0 ? `  ${anchorId} --> ${id}` : `  ${generatedIds[index - 1]} --> ${id}`);

    const insertion = [
        "",
        '  subgraph "Expanded Detail"',
        ...detailLines,
        ...detailEdges,
        "  end",
    ].join("\n");

    if (trimmed.includes("\nend")) {
        return `${trimmed}${insertion}`;
    }

    return `${trimmed}${insertion}`;
}

/**
 * Enhanced Mermaid validation
 * Checks for specific syntax issues beyond just diagram type.
 */
export function validateMermaidSyntax(code: string): { valid: boolean; error?: string } {
    try {
        const trimmed = code.trim();

        if (!trimmed) {
            return { valid: false, error: 'Empty diagram code' };
        }

        // 1. Check for valid diagram type
        const hasValidType = VALID_MERMAID_DIAGRAM_TYPES.some((type) => trimmed.startsWith(type));

        if (!hasValidType) {
            return { valid: false, error: 'Missing or invalid diagram type declaration' };
        }

        // 2. Check for common syntax errors
        const checks = [
            {
                test: /--[^>]/,
                error: 'Potential incomplete arrow syntax (found "--" without ">")'
            },
            {
                test: /\[\[(?!.*\]\])/,
                error: 'Unmatched double brackets "[["'
            },
            {
                test: /\(\((?!.*\)\))/,
                error: 'Unmatched double parentheses "(("'
            },
            {
                test: /\{(?!.*\})/,
                error: 'Unmatched curly braces'
            }
        ];

        for (const check of checks) {
            if (check.test.test(trimmed)) {
                return { valid: false, error: check.error };
            }
        }

        const diagramType = extractDiagramType(trimmed);
        if ((diagramType === "graph" || diagramType === "flowchart") && countMermaidFlowchartNodes(trimmed) < MIN_FLOWCHART_NODE_COUNT) {
            return { valid: false, error: `Flowchart must contain at least ${MIN_FLOWCHART_NODE_COUNT} nodes.` };
        }

        return { valid: true };
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown validation error';
        return { valid: false, error: errorMessage };
    }
}

/**
 * Sanitize Mermaid code (fix common AI mistakes)
 * Smarter, less aggressive sanitization
 */
export function sanitizeMermaidCode(code: string): string {
    // 1. Basic cleanup
    let sanitized = code
        .replace(/\r\n/g, '\n') // Normalize newlines
        .replace(/\\n/g, '\n'); // Fix escaped newlines often sent by LLMs

    // 2. Remove comments
    sanitized = sanitized.split('\n').map(line => {
        const commentIndex = line.indexOf('%%');
        return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    }).join('\n');

    const diagramType = extractDiagramType(sanitized);
    if (diagramType === "mindmap" || diagramType === "gantt") {
        return sanitized
            .split('\n')
            .map((line) => line.replace(/[ \t]+$/g, ""))
            .filter((line) => line.trim().length > 0)
            .join('\n')
            .trim();
    }

    // 3. Process line by line
    const lines = sanitized.split('\n');
    const processedLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';

        // Skip directives and class definitions
        if (trimmed.match(/^(classDef|class|click|style|linkStyle)\s/)) {
            return trimmed;
        }

        // Handle subgraph
        if (trimmed.startsWith('subgraph ')) {
            const title = trimmed.substring(9).trim();
            // Ensure title is quoted if it contains spaces or special chars
            if (!title.startsWith('"') && !title.startsWith('[')) {
                return `subgraph "${title.replace(/"/g, "'")}"`;
            }
            return trimmed;
        }

        // Fix node definitions with special characters in labels
        // Matches: ID[Label with (special) chars] or ID(Label) or ID((Label))
        const nodeDefRegex = /^([a-zA-Z0-9_-]+)(\[|\(\(|\(|\[\[|\{\{)(.*?)(\]|\)\)|\)|\]\]|\}\})$/;
        const nodeMatch = trimmed.match(nodeDefRegex);
        if (nodeMatch) {
            const [, id, open, label, close] = nodeMatch;
            if (!label.startsWith('"') && (label.includes('(') || label.includes(')') || label.includes('[') || label.includes(']'))) {
                return `${id}${open}"${label.replace(/"/g, "'")}"${close}`;
            }
        }

        // Fix arrow syntax: A -- Label --> B
        // We want to ensure the label is quoted: A -- "Label" --> B
        if (trimmed.includes('-->') || trimmed.includes('-.->') || trimmed.includes('==>')) {
            // Regex to find unquoted text between arrow parts
            const arrowLabelRegex = /(--|\.-|==)\s+([a-zA-Z0-9\s.,;:!?()_-]+?)\s+(-->|\.->|==>)/;
            const match = trimmed.match(arrowLabelRegex);
            if (match) {
                const [full, start, label, end] = match;
                if (!label.includes('"')) {
                    return trimmed.replace(full, `${start} "${label.trim()}" ${end}`);
                }
            }
        }

        // Ensure flowchart/graph always has a direction if missing
        if (trimmed === 'graph' || trimmed === 'flowchart') {
            return `${trimmed} TD`;
        }

        return trimmed;
    });

    // Ensure all subgraphs are closed
    let subgraphCount = 0;
    const finalLines = processedLines.filter(l => l).map(line => {
        if (line.startsWith('subgraph')) subgraphCount++;
        if (line === 'end') subgraphCount--;
        return line;
    });

    while (subgraphCount > 0) {
        finalLines.push('end');
        subgraphCount--;
    }

    return finalLines.join('\n');
}

/**
 * Extract diagram type from code
 */
export function extractDiagramType(code: string): string {
    const trimmed = code.trim();

    if (!trimmed) {
        return "unknown";
    }

    if (trimmed.startsWith("graph") || trimmed.startsWith("flowchart")) {
        return "flowchart";
    }

    for (const diagramType of MERMAID_DIAGRAM_DECLARATIONS) {
        if (trimmed.startsWith(diagramType)) {
            return diagramType;
        }
    }

    return "unknown";
}

/**
 * Get a fallback template based on context
 */
export function getFallbackTemplate(context?: string): string {
    if (!context) {
        return templates.basicFlow(['Start', 'Validate', 'Plan', 'Execute', 'Review', 'End']);
    }

    // Try to infer what kind of diagram to use
    const lower = context.toLowerCase();

    if (lower.includes('layer') || lower.includes('tier')) {
        return templates.layeredArch(['Frontend', 'Backend', 'Database']);
    }

    if (lower.includes('service') || lower.includes('microservice')) {
        return templates.serviceArch();
    }

    if (lower.includes('component') || lower.includes('dependency')) {
        return templates.componentDiagram([
            { name: 'Component A', deps: ['Component B'] },
            { name: 'Component B', deps: ['Component C'] },
            { name: 'Component C', deps: ['Component D'] },
            { name: 'Component D', deps: ['Component E'] },
            { name: 'Component E', deps: ['Component F'] },
            { name: 'Component F', deps: [] }
        ]);
    }

    // Default fallback
    return templates.basicFlow(['Start', 'Validate', 'Plan', 'Execute', 'Review', 'End']);
}

/**
 * Types for JSON-based Mermaid generation
 */
export type MermaidJsonDiagramType =
    | "flowchart"
    | "sequenceDiagram"
    | "stateDiagram-v2"
    | "mindmap"
    | "gantt"
    | "classDiagram"
    | "erDiagram";

export interface MermaidNode {
    id: string;
    label: string;
    shape?: "rect" | "rounded" | "circle" | "diamond" | "database" | "cloud" | "hexagon";
}

export interface MermaidEdge {
    from: string;
    to: string;
    label?: string;
    type?: "arrow" | "dotted" | "thick" | "line";
}

export interface MermaidFlowchartDiagramData {
    diagramType?: "flowchart" | "graph";
    title?: string;
    direction?: "TB" | "TD" | "BT" | "RL" | "LR";
    nodes: MermaidNode[];
    edges: MermaidEdge[];
}

export interface MermaidSequenceParticipant {
    id: string;
    label?: string;
    kind?: "participant" | "actor" | "boundary" | "control" | "entity" | "database" | "collections" | "queue";
}

export interface MermaidSequenceMessage {
    from: string;
    to: string;
    text: string;
    kind?: "sync" | "async" | "reply" | "create" | "destroy";
}

export interface MermaidSequenceDiagramData {
    diagramType: "sequenceDiagram";
    title?: string;
    participants: MermaidSequenceParticipant[];
    messages: MermaidSequenceMessage[];
}

export interface MermaidStateNode {
    id: string;
    label?: string;
    kind?: "state" | "start" | "end";
}

export interface MermaidStateTransition {
    from: string;
    to: string;
    label?: string;
}

export interface MermaidStateDiagramData {
    diagramType: "stateDiagram-v2";
    title?: string;
    states: MermaidStateNode[];
    transitions: MermaidStateTransition[];
    initialState?: string;
}

export interface MermaidMindmapNode {
    label: string;
    children?: MermaidMindmapNode[];
}

export interface MermaidMindmapDiagramData {
    diagramType: "mindmap";
    title?: string;
    root: MermaidMindmapNode;
}

export interface MermaidGanttTask {
    id: string;
    label: string;
    start?: string;
    end?: string;
    after?: string[];
    milestone?: boolean;
    done?: boolean;
}

export interface MermaidGanttSection {
    name: string;
    tasks: MermaidGanttTask[];
}

export interface MermaidGanttDiagramData {
    diagramType: "gantt";
    title?: string;
    dateFormat: string;
    axisFormat?: string;
    sections: MermaidGanttSection[];
}

export interface MermaidClassAttribute {
    name: string;
    type?: string;
}

export interface MermaidClassMethod {
    signature: string;
}

export interface MermaidClassDefinition {
    name: string;
    attributes?: MermaidClassAttribute[];
    methods?: MermaidClassMethod[];
}

export interface MermaidClassRelation {
    from: string;
    to: string;
    kind?: "inheritance" | "composition" | "aggregation" | "association" | "dependency";
    label?: string;
}

export interface MermaidClassDiagramData {
    diagramType: "classDiagram";
    title?: string;
    classes: MermaidClassDefinition[];
    relations?: MermaidClassRelation[];
}

export interface MermaidErAttribute {
    name: string;
    type?: string;
    key?: "pk" | "fk" | "uk";
}

export interface MermaidErEntity {
    name: string;
    attributes: MermaidErAttribute[];
}

export interface MermaidErRelation {
    from: string;
    to: string;
    cardinality?: string;
    label?: string;
}

export interface MermaidErDiagramData {
    diagramType: "erDiagram";
    title?: string;
    entities: MermaidErEntity[];
    relations?: MermaidErRelation[];
}

export type MermaidTypedDiagramData =
    | MermaidFlowchartDiagramData
    | MermaidSequenceDiagramData
    | MermaidStateDiagramData
    | MermaidMindmapDiagramData
    | MermaidGanttDiagramData
    | MermaidClassDiagramData
    | MermaidErDiagramData;

export interface MermaidJsonCompileResult {
    valid: boolean;
    diagramType?: MermaidJsonDiagramType;
    mermaid?: string;
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanLabel(text: string): string {
    return text ? text.replace(/["\n\r]/g, " ").trim() : "";
}

function cleanId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function normalizeDiagramType(value: unknown): MermaidJsonDiagramType | "flowchart" | null {
    if (value === "graph" || value === "flowchart" || value == null) {
        return "flowchart";
    }

    if (
        value === "sequenceDiagram" ||
        value === "stateDiagram-v2" ||
        value === "mindmap" ||
        value === "gantt" ||
        value === "classDiagram" ||
        value === "erDiagram"
    ) {
        return value;
    }

    return null;
}

function getFlowchartShape(id: string, label: string, shape?: string) {
    const safeId = cleanId(id);
    const clean = cleanLabel(label || safeId);

    switch (shape) {
        case "rounded":
            return `${safeId}("${clean}")`;
        case "circle":
            return `${safeId}(("${clean}"))`;
        case "diamond":
            return `${safeId}{"${clean}"}`;
        case "database":
            return `${safeId}[("${clean}")]`;
        case "cloud":
            return `${safeId}(("${clean}"))`;
        case "hexagon":
            return `${safeId}{{"${clean}"}}`;
        case "rect":
        default:
            return `${safeId}["${clean}"]`;
    }
}

function getFlowchartEdge(type?: string, label?: string) {
    const clean = label ? cleanLabel(label) : "";
    const labelPart = clean ? `|"${clean}"|` : "";

    switch (type) {
        case "dotted":
            return `-.->${labelPart}`;
        case "thick":
            return `==>${labelPart}`;
        case "line":
            return `---${labelPart}`;
        case "arrow":
        default:
            return `-->${labelPart}`;
    }
}

function compileFlowchartDiagram(data: MermaidFlowchartDiagramData | Record<string, unknown>): MermaidJsonCompileResult {
    const source = data as MermaidFlowchartDiagramData | Record<string, unknown>;
    const direction = typeof source.direction === "string" ? source.direction : "TD";
    const nodes = Array.isArray(source.nodes) ? source.nodes : [];
    const edges = Array.isArray(source.edges) ? source.edges : [];

    if (nodes.length === 0) {
        return { valid: false, diagramType: "flowchart", error: "Flowchart JSON must include at least one node." };
    }

    const lines = [
        `graph ${direction}`,
        ...nodes.map((node) => {
            const entry = node as MermaidNode;
            if (!entry.id || !entry.label) {
                return null;
            }
            return `  ${getFlowchartShape(entry.id, entry.label, entry.shape)}`;
        }).filter((line): line is string => Boolean(line)),
        ...edges.map((edge) => {
            const entry = edge as MermaidEdge;
            if (!entry.from || !entry.to) {
                return null;
            }
            return `  ${cleanId(entry.from)} ${getFlowchartEdge(entry.type, entry.label)} ${cleanId(entry.to)}`;
        }).filter((line): line is string => Boolean(line))
    ];

    if (lines.length <= 1) {
        return { valid: false, diagramType: "flowchart", error: "Flowchart JSON is missing valid nodes or edges." };
    }

    return { valid: true, diagramType: "flowchart", mermaid: lines.join("\n") };
}

function compileSequenceDiagram(data: MermaidSequenceDiagramData): MermaidJsonCompileResult {
    if (!Array.isArray(data.participants) || data.participants.length < 2) {
        return { valid: false, diagramType: "sequenceDiagram", error: "Sequence JSON must include at least two participants." };
    }

    if (!Array.isArray(data.messages) || data.messages.length === 0) {
        return { valid: false, diagramType: "sequenceDiagram", error: "Sequence JSON must include at least one message." };
    }

    const lines = ["sequenceDiagram"];
    if (data.title) {
        lines.push(`  %% ${cleanLabel(data.title)}`);
    }

    for (const participant of data.participants) {
        if (!participant.id) continue;
        const label = cleanLabel(participant.label || participant.id);
        const prefix = participant.kind && participant.kind !== "participant" ? `${participant.kind} ` : "participant ";
        lines.push(`  ${prefix}${cleanId(participant.id)} as ${label}`);
    }

    const arrowForKind = (kind?: MermaidSequenceMessage["kind"]) => {
        switch (kind) {
            case "async":
                return "->>";
            case "reply":
                return "-->>";
            case "create":
                return "->>";
            case "destroy":
                return "-x";
            case "sync":
            default:
                return "->>";
        }
    };

    for (const message of data.messages) {
        if (!message.from || !message.to || !message.text) continue;
        lines.push(`  ${cleanId(message.from)}${arrowForKind(message.kind)}${cleanId(message.to)}: ${cleanLabel(message.text)}`);
    }

    return { valid: true, diagramType: "sequenceDiagram", mermaid: lines.join("\n") };
}

function compileStateDiagram(data: MermaidStateDiagramData): MermaidJsonCompileResult {
    if (!Array.isArray(data.states) || data.states.length === 0) {
        return { valid: false, diagramType: "stateDiagram-v2", error: "State JSON must include at least one state." };
    }

    const lines = ["stateDiagram-v2"];
    if (data.title) {
        lines.push(`  %% ${cleanLabel(data.title)}`);
    }

    const declaredAliases = new Set<string>();
    const transitionStateIds = new Set<string>();

    for (const transition of data.transitions ?? []) {
        if (transition.from) {
            transitionStateIds.add(cleanId(transition.from));
        }
        if (transition.to) {
            transitionStateIds.add(cleanId(transition.to));
        }
    }

    const startStateIds = new Set<string>();
    if (data.initialState) {
        startStateIds.add(cleanId(data.initialState));
    }

    for (const state of data.states) {
        if (!state.id) continue;
        const id = cleanId(state.id);
        if (state.kind === "start") {
            startStateIds.add(id);
        }

        const label = cleanLabel(state.label ?? "");
        if (label && label !== state.id && !declaredAliases.has(id)) {
            lines.push(`  state "${label}" as ${id}`);
            declaredAliases.add(id);
            if (state.kind === "end") {
                lines.push(`  ${id} --> [*]`);
            }
            continue;
        }

        if (state.kind !== "end" && !transitionStateIds.has(id) && !startStateIds.has(id)) {
            lines.push(`  state ${id}`);
        }

        if (state.kind === "end") {
            lines.push(`  ${id} --> [*]`);
        }
    }

    for (const startStateId of startStateIds) {
        lines.push(`  [*] --> ${startStateId}`);
    }

    if (!Array.isArray(data.transitions) || data.transitions.length === 0) {
        return { valid: false, diagramType: "stateDiagram-v2", error: "State JSON must include at least one transition." };
    }

    for (const transition of data.transitions) {
        if (!transition.from || !transition.to) continue;
        const label = transition.label ? `: ${cleanLabel(transition.label)}` : "";
        lines.push(`  ${cleanId(transition.from)} --> ${cleanId(transition.to)}${label}`);
    }

    return { valid: true, diagramType: "stateDiagram-v2", mermaid: lines.join("\n") };
}

function compileMindmapDiagram(data: MermaidMindmapDiagramData): MermaidJsonCompileResult {
    if (!data.root || !data.root.label) {
        return { valid: false, diagramType: "mindmap", error: "Mindmap JSON must include a root label." };
    }

    const lines = ["mindmap"];
    if (data.title) {
        lines.push(`  %% ${cleanLabel(data.title)}`);
    }

    const renderNode = (node: MermaidMindmapNode, depth: number) => {
        const indent = "  ".repeat(depth + 1);
        const label = cleanLabel(node.label);
        if (!label) return;
        lines.push(`${indent}${label}`);
        for (const child of node.children ?? []) {
            renderNode(child, depth + 1);
        }
    };

    renderNode(data.root, 0);
    return { valid: true, diagramType: "mindmap", mermaid: lines.join("\n") };
}

function compileGanttDiagram(data: MermaidGanttDiagramData): MermaidJsonCompileResult {
    if (!data.dateFormat) {
        return { valid: false, diagramType: "gantt", error: "Gantt JSON must include a dateFormat." };
    }

    if (!Array.isArray(data.sections) || data.sections.length === 0) {
        return { valid: false, diagramType: "gantt", error: "Gantt JSON must include at least one section." };
    }

    const lines = ["gantt"];
    if (data.title) {
        lines.push(`  title ${cleanLabel(data.title)}`);
    }
    lines.push(`  dateFormat ${cleanLabel(data.dateFormat)}`);
    if (data.axisFormat) {
        lines.push(`  axisFormat ${cleanLabel(data.axisFormat)}`);
    }

    const parseDate = (value?: string) => {
        if (!value) return null;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    };

    const formatDuration = (start?: string, end?: string, milestone = false) => {
        if (milestone) {
            return "0d";
        }

        if (!start) {
            return "1d";
        }

        const startTime = parseDate(start);
        const endTime = parseDate(end);

        if (startTime == null || endTime == null) {
            return "1d";
        }

        const diffDays = Math.max(1, Math.round((endTime - startTime) / 86400000));
        return `${diffDays}d`;
    };

    for (const section of data.sections) {
        if (!section.name) continue;
        lines.push(`  section ${cleanLabel(section.name)}`);
        for (const task of section.tasks ?? []) {
            if (!task.id || !task.label) continue;
            const pieces: string[] = [];
            if (task.done) {
                pieces.push("done");
            }
            if (task.milestone) {
                pieces.push("milestone");
            }
            pieces.push(cleanId(task.id));
            if (task.after?.length) {
                pieces.push(`after ${task.after.map(cleanId).join(" ")}`);
            } else if (task.start) {
                pieces.push(cleanLabel(task.start));
            }
            pieces.push(formatDuration(task.start, task.end, task.milestone));
            lines.push(`  ${cleanLabel(task.label)} : ${pieces.join(", ")}`);
        }
    }

    return { valid: true, diagramType: "gantt", mermaid: lines.join("\n") };
}

function compileClassDiagram(data: MermaidClassDiagramData): MermaidJsonCompileResult {
    if (!Array.isArray(data.classes) || data.classes.length === 0) {
        return { valid: false, diagramType: "classDiagram", error: "Class JSON must include at least one class." };
    }

    const lines = ["classDiagram"];
    if (data.title) {
        lines.push(`  %% ${cleanLabel(data.title)}`);
    }

    for (const classDef of data.classes) {
        if (!classDef.name) continue;
        const classId = cleanId(classDef.name);
        lines.push(`  class ${classId} {`);
        for (const attribute of classDef.attributes ?? []) {
            if (!attribute.name) continue;
            const typePart = attribute.type ? `${cleanLabel(attribute.type)} ` : "";
            lines.push(`    ${typePart}${cleanLabel(attribute.name)}`);
        }
        for (const method of classDef.methods ?? []) {
            if (!method.signature) continue;
            lines.push(`    ${cleanLabel(method.signature)}`);
        }
        lines.push("  }");
    }

    for (const relation of data.relations ?? []) {
        if (!relation.from || !relation.to) continue;
        const arrow = (() => {
            switch (relation.kind) {
                case "composition":
                    return "*--";
                case "aggregation":
                    return "o--";
                case "dependency":
                    return "..>";
                case "association":
                    return "--";
                case "inheritance":
                default:
                    return "<|--";
            }
        })();
        const label = relation.label ? ` : ${cleanLabel(relation.label)}` : "";
        lines.push(`  ${cleanId(relation.from)} ${arrow} ${cleanId(relation.to)}${label}`);
    }

    return { valid: true, diagramType: "classDiagram", mermaid: lines.join("\n") };
}

function compileErDiagram(data: MermaidErDiagramData): MermaidJsonCompileResult {
    if (!Array.isArray(data.entities) || data.entities.length === 0) {
        return { valid: false, diagramType: "erDiagram", error: "ER JSON must include at least one entity." };
    }

    const lines = ["erDiagram"];
    if (data.title) {
        lines.push(`  %% ${cleanLabel(data.title)}`);
    }

    for (const entity of data.entities) {
        if (!entity.name) continue;
        lines.push(`  ${cleanId(entity.name)} {`);
        for (const attribute of entity.attributes ?? []) {
            if (!attribute.name) continue;
            const typePart = attribute.type ? `${cleanLabel(attribute.type)} ` : "";
            const keyPart = attribute.key ? ` ${attribute.key.toUpperCase()}` : "";
            lines.push(`    ${typePart}${cleanLabel(attribute.name)}${keyPart}`);
        }
        lines.push("  }");
    }

    for (const relation of data.relations ?? []) {
        if (!relation.from || !relation.to) continue;
        const label = relation.label ? ` : ${cleanLabel(relation.label)}` : "";
        const cardinality = relation.cardinality?.trim();
        const safeCardinality = cardinality && /^[|}o]+--[|{o]+$/.test(cardinality) ? cardinality : "||--o{";
        lines.push(`  ${cleanId(relation.from)} ${safeCardinality} ${cleanId(relation.to)}${label}`);
    }

    return { valid: true, diagramType: "erDiagram", mermaid: lines.join("\n") };
}

function compileTypedMermaidJson(data: unknown): MermaidJsonCompileResult {
    if (!isRecord(data)) {
        return { valid: false, error: "Mermaid JSON must be an object." };
    }

    const explicitDiagramType = normalizeDiagramType(data.diagramType);
    const legacyFlowchart = !explicitDiagramType && !data.diagramType && Array.isArray(data.nodes) && Array.isArray(data.edges);
    const diagramType = explicitDiagramType ?? (legacyFlowchart ? "flowchart" : null);
    const payload = isRecord(data.payload) ? data.payload : data;

    if (!diagramType) {
        return { valid: false, error: "Missing or unsupported diagramType in Mermaid JSON." };
    }

    switch (diagramType) {
        case "flowchart":
            return compileFlowchartDiagram(payload);
        case "sequenceDiagram":
            return compileSequenceDiagram({
                diagramType: "sequenceDiagram",
                title: typeof data.title === "string" ? data.title : undefined,
                participants: Array.isArray(payload.participants) ? payload.participants as MermaidSequenceParticipant[] : [],
                messages: Array.isArray(payload.messages) ? payload.messages as MermaidSequenceMessage[] : [],
            });
        case "stateDiagram-v2":
            return compileStateDiagram({
                diagramType: "stateDiagram-v2",
                title: typeof data.title === "string" ? data.title : undefined,
                states: Array.isArray(payload.states) ? payload.states as MermaidStateNode[] : [],
                transitions: Array.isArray(payload.transitions) ? payload.transitions as MermaidStateTransition[] : [],
                initialState: typeof payload.initialState === "string" ? payload.initialState : undefined,
            });
        case "mindmap":
            return compileMindmapDiagram({
                diagramType: "mindmap",
                title: typeof data.title === "string" ? data.title : undefined,
                root: (payload.root as MermaidMindmapNode) ?? { label: "" },
            });
        case "gantt":
            return compileGanttDiagram({
                diagramType: "gantt",
                title: typeof data.title === "string" ? data.title : undefined,
                dateFormat: typeof payload.dateFormat === "string" ? payload.dateFormat : "",
                axisFormat: typeof payload.axisFormat === "string" ? payload.axisFormat : undefined,
                sections: Array.isArray(payload.sections) ? payload.sections as MermaidGanttSection[] : [],
            });
        case "classDiagram":
            return compileClassDiagram({
                diagramType: "classDiagram",
                title: typeof data.title === "string" ? data.title : undefined,
                classes: Array.isArray(payload.classes) ? payload.classes as MermaidClassDefinition[] : [],
                relations: Array.isArray(payload.relations) ? payload.relations as MermaidClassRelation[] : [],
            });
        case "erDiagram":
            return compileErDiagram({
                diagramType: "erDiagram",
                title: typeof data.title === "string" ? data.title : undefined,
                entities: Array.isArray(payload.entities) ? payload.entities as MermaidErEntity[] : [],
                relations: Array.isArray(payload.relations) ? payload.relations as MermaidErRelation[] : [],
            });
        default:
            return { valid: false, error: `Unsupported Mermaid diagram type: ${String(diagramType)}` };
    }
}

/**
 * Generate valid Mermaid code from structured JSON data.
 * Supports both the legacy flowchart JSON and the newer typed JSON envelope.
 */
export function generateMermaidFromJSON(data: unknown): string | null {
    const result = compileTypedMermaidJson(data);
    return result.valid ? result.mermaid ?? null : null;
}

export function compileMermaidFromJSON(data: unknown): MermaidJsonCompileResult {
    return compileTypedMermaidJson(data);
}
