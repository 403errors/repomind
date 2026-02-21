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

        if (sanitized.length === 0) {
            sanitized.push('Start', 'Process', 'End');
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
  end
  subgraph Backend
    API["${clean(layers[1] || 'API Layer')}"]
  end
  subgraph Data
    DB["${clean(layers[2] || 'Database')}"]
  end
  UI --> API
  API --> DB`;
    },

    /**
     * Component dependency diagram
     */
    componentDiagram: (components: Array<{ name: string; deps?: string[] }>) => `
graph LR
${components.map(c => `  ${c.name.replace(/[^a-zA-Z0-9]/g, '_')}["${c.name}"]`).join('\n')}
${components.flatMap(c =>
        (c.deps || []).map(d => `  ${c.name.replace(/[^a-zA-Z0-9]/g, '_')} --> ${d.replace(/[^a-zA-Z0-9]/g, '_')}`)
    ).join('\n')}
  `,

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

        return { valid: true };
    } catch (e: any) {
        return { valid: false, error: e.message || 'Unknown validation error' };
    }
}

/**
 * Sanitize text content for Mermaid diagrams
 * Context-aware sanitization that preserves valid syntax
 */
function sanitizeMermaidText(text: string): string {
    return text
        // Strip HTML tags but keep content
        .replace(/<[^>]*>/g, ' ')
        // Remove potentially dangerous characters but keep quotes if they look intentional
        // We only remove quotes if they are unbalanced or weirdly placed
        .replace(/[\\]/g, ' ') // Remove backslashes
        .replace(/[\t]/g, ' ') // Remove tabs
        .trim();
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
        let trimmed = line.trim();
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

        // Fix arrow syntax: A -- Label --> B
        // We want to ensure the label is quoted: A -- "Label" --> B
        if (trimmed.includes('-->') || trimmed.includes('-.->') || trimmed.includes('==>')) {
            // Regex to find unquoted text between arrow parts
            // Matches: -- text -->, -. text .->, == text ==>
            const arrowLabelRegex = /(--|\.-|==)\s+([a-zA-Z0-9\s]+?)\s+(-->|\.->|==>)/;
            const match = trimmed.match(arrowLabelRegex);
            if (match) {
                const [full, start, label, end] = match;
                if (!label.includes('"')) {
                    return trimmed.replace(full, `${start} "${label.trim()}" ${end}`);
                }
            }
        }

        return trimmed;
    });

    return processedLines.filter(l => l).join('\n');
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
        return templates.basicFlow(['Start', 'Process', 'End']);
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
            { name: 'Component C', deps: [] }
        ]);
    }

    // Default fallback
    return templates.basicFlow(['Start', 'Process', 'End']);
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
