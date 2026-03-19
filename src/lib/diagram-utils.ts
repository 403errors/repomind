/**
 * Fallback diagram templates for when AI generation fails
 */

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
        const validTypes = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitGraph'];
        const hasValidType = validTypes.some(type => trimmed.startsWith(type));

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
    const match = code.match(/(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt)/);
    return match ? match[1] : 'unknown';
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
export interface MermaidNode {
    id: string;
    label: string;
    shape?: 'rect' | 'rounded' | 'circle' | 'diamond' | 'database' | 'cloud' | 'hexagon';
}

export interface MermaidEdge {
    from: string;
    to: string;
    label?: string;
    type?: 'arrow' | 'dotted' | 'thick' | 'line';
}

export interface MermaidDiagramData {
    title?: string;
    direction?: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
    nodes: MermaidNode[];
    edges: MermaidEdge[];
}

/**
 * Generate valid Mermaid code from structured JSON data
 * This guarantees syntax correctness by handling escaping and formatting programmatically
 */
export function generateMermaidFromJSON(data: MermaidDiagramData): string {
    const { direction = 'TD', nodes = [], edges = [] } = data;

    // Helper to sanitize label text (keep it minimal, we will quote it)
    const cleanLabel = (text: string) => {
        return text ? text.replace(/["\n\r]/g, ' ').trim() : '';
    };

    // Helper to sanitize IDs (must be alphanumeric, no spaces)
    const cleanId = (id: string) => {
        return id.replace(/[^a-zA-Z0-9]/g, '_');
    };

    // Helper to get shape syntax
    const getShape = (id: string, label: string, shape?: string) => {
        const safeId = cleanId(id);
        const clean = cleanLabel(label || safeId); // Fallback to ID if label missing
        switch (shape) {
            case 'rounded': return `${safeId}("${clean}")`;
            case 'circle': return `${safeId}(("${clean}"))`;
            case 'diamond': return `${safeId}{"${clean}"}`;
            case 'database': return `${safeId}[("${clean}")]`;
            case 'cloud': return `${safeId}(("${clean}"))`;
            case 'hexagon': return `${safeId}{{"${clean}"}}`;
            case 'rect':
            default: return `${safeId}["${clean}"]`;
        }
    };

    // Helper to get edge syntax
    const getEdge = (type?: string, label?: string) => {
        const clean = label ? cleanLabel(label) : '';
        const labelPart = clean ? `|"${clean}"|` : '';

        switch (type) {
            case 'dotted': return `-.->${labelPart}`;
            case 'thick': return `==>${labelPart}`;
            case 'line': return `---${labelPart}`;
            case 'arrow':
            default: return `-->${labelPart}`;
        }
    };

    const lines = [
        `graph ${direction}`,
        ...nodes.map(n => `  ${getShape(n.id, n.label, n.shape)}`),
        ...edges.map(e => `  ${cleanId(e.from)} ${getEdge(e.type, e.label)} ${cleanId(e.to)}`)
    ];

    return lines.join('\n');
}
