import { describe, it, expect } from "vitest";
import {
    validateMermaidSyntax,
    sanitizeMermaidCode,
    extractDiagramType,
    getFallbackTemplate,
    generateMermaidFromJSON,
    templates,
    countMermaidFlowchartNodes,
    ensureMermaidMinimumDetail,
    isSupportedMermaidVisualCode,
} from "@/lib/diagram-utils";

describe("validateMermaidSyntax", () => {
    it("validates a correct flowchart", () => {
        const result = validateMermaidSyntax(
            `flowchart TD
  A["Start"]
  B["Validate"]
  C["Plan"]
  D["Execute"]
  E["Review"]
  F["End"]
  A --> B
  B --> C
  C --> D
  D --> E
  E --> F`
        );
        expect(result.valid).toBe(true);
    });

    it("validates a correct sequenceDiagram", () => {
        const result = validateMermaidSyntax("sequenceDiagram\n  Alice->>Bob: Hello");
        expect(result.valid).toBe(true);
    });

    it("returns invalid for an empty string", () => {
        const result = validateMermaidSyntax("");
        expect(result.valid).toBe(false);
    });

    it("returns invalid for unrecognized diagram type", () => {
        const result = validateMermaidSyntax("invalidtype TD\n  A --> B");
        expect(result.valid).toBe(false);
    });

    it("validates a classDiagram", () => {
        const result = validateMermaidSyntax("classDiagram\n  class Animal");
        expect(result.valid).toBe(true);
    });

    it("validates a mindmap", () => {
        const result = validateMermaidSyntax("mindmap\n  root((RepoMind))");
        expect(result.valid).toBe(true);
    });

    it("rejects undersized flowcharts", () => {
        const result = validateMermaidSyntax("flowchart TD\n  A --> B\n  B --> C");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("at least 6 nodes");
    });

    it("pads undersized flowcharts with family-aware detail", () => {
        const expanded = ensureMermaidMinimumDetail(
            "flowchart TD\n  A[\"Start\"]\n  A --> B\n  B --> C",
            "pipeline workflow"
        );

        expect(expanded).toContain("Expanded Detail");
        expect(countMermaidFlowchartNodes(expanded)).toBeGreaterThanOrEqual(6);
        expect(expanded).toContain("Trigger");
        expect(validateMermaidSyntax(expanded).valid).toBe(true);
    });
});

describe("sanitizeMermaidCode", () => {
    it("passes through clean mermaid code without extra fences", () => {
        const clean = "flowchart TD\n  A --> B";
        const result = sanitizeMermaidCode(clean);
        expect(result).toContain("flowchart");
    });

    it("preserves mindmap indentation", () => {
        const result = sanitizeMermaidCode(`mindmap
  RepoMind
    API
    UI
`);

        expect(result).toContain("mindmap");
        expect(result).toContain("\n  RepoMind");
        expect(result).toContain("\n    API");
    });

    it("trims leading/trailing whitespace", () => {
        const result = sanitizeMermaidCode("  flowchart TD\n  A --> B  ");
        expect(result).toBe(result.trim());
    });

    it("returns passthrough for clean code", () => {
        const clean = "flowchart TD\n  A --> B";
        const result = sanitizeMermaidCode(clean);
        expect(result).toContain("flowchart");
    });

    it("removes flowchart style directives to preserve app theme", () => {
        const result = sanitizeMermaidCode(`flowchart TD
  A["Start"]
  B["End"]
  style A fill:#fff,stroke:#111
  classDef hot fill:#f00
  class B hot
  A --> B`);

        expect(result).not.toContain("style A");
        expect(result).not.toContain("classDef");
        expect(result).not.toContain("class B");
    });

    it("normalizes xychart-beta declarations to xychart", () => {
        const result = sanitizeMermaidCode("xychart-beta\n  line [1, 2, 3]");
        expect(result).toContain("xychart");
        expect(result).not.toContain("xychart-beta");
    });
});

describe("extractDiagramType", () => {
    it("extracts 'flowchart'", () => {
        expect(extractDiagramType("flowchart TD\n  A --> B")).toBe("flowchart");
    });

    it("extracts 'sequenceDiagram'", () => {
        expect(extractDiagramType("sequenceDiagram\n  A->>B: hi")).toBe("sequenceDiagram");
    });

    it("extracts 'classDiagram'", () => {
        expect(extractDiagramType("classDiagram\n  class Foo")).toBe("classDiagram");
    });

    it("extracts 'mindmap'", () => {
        expect(extractDiagramType("mindmap\n  root((RepoMind))")).toBe("mindmap");
    });

    it("extracts 'xychart' from xychart-beta alias", () => {
        expect(extractDiagramType("xychart-beta\n  line [1,2,3]")).toBe("xychart");
    });

    it("returns unknown for removed diagram declarations", () => {
        expect(extractDiagramType("pie\n  title X")).toBe("unknown");
    });

    it("enforces supported visual declaration whitelist", () => {
        expect(isSupportedMermaidVisualCode("xychart\n  line [1,2,3]")).toBe(true);
        expect(isSupportedMermaidVisualCode("xychart-beta\n  line [1,2,3]")).toBe(true);
        expect(isSupportedMermaidVisualCode("pie\n  \"A\": 10")).toBe(false);
    });

    it("returns 'unknown' for unrecognized input", () => {
        expect(extractDiagramType("something random")).toBe("unknown");
    });
});

describe("getFallbackTemplate", () => {
    it("returns a non-empty string", () => {
        const result = getFallbackTemplate();
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    it("returns a string containing mermaid syntax keywords", () => {
        const result = getFallbackTemplate("API service");
        expect(result).toMatch(/flowchart|sequenceDiagram|classDiagram/i);
    });
});

describe("generateMermaidFromJSON", () => {
    it("generates a basic flowchart with two nodes and one edge", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                nodes: [
                    { id: "A", label: "Start" },
                    { id: "B", label: "End" },
                ],
                edges: [{ from: "A", to: "B" }],
            },
        });
        expect(result).toContain("flowchart TD");
        expect(result).toContain("Start");
        expect(result).toContain("End");
    });

    it("supports legacy flowchart JSON without an explicit diagramType", () => {
        const result = generateMermaidFromJSON({
            nodes: [
                { id: "A", label: "Start" },
                { id: "B", label: "End" },
            ],
            edges: [{ from: "A", to: "B" }],
        });

        expect(result).toContain("flowchart TD");
        expect(result).toContain("Start");
        expect(result).toContain("End");
    });

    it("auto-connects orphan flowchart nodes", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                nodes: [
                    { id: "A", label: "Start" },
                    { id: "B", label: "Process" },
                    { id: "C", label: "User Interaction" },
                ],
                edges: [{ from: "A", to: "B" }],
            },
        });

        expect(result).toContain("A --> B");
        expect(result).toContain("B --> C");
    });

    it("respects direction setting", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                direction: "LR",
                nodes: [{ id: "X", label: "Node" }],
                edges: [],
            },
        });
        expect(result).toContain("LR");
    });

    it("includes edge labels when provided", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                nodes: [
                    { id: "A", label: "Alpha" },
                    { id: "B", label: "Beta" },
                ],
                edges: [{ from: "A", to: "B", label: "depends on" }],
            },
        });
        expect(result).toContain("depends on");
    });

    it("rewrites direct flowchart self-loops through an intermediate helper node", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                nodes: [{ id: "A", label: "Validate" }],
                edges: [{ from: "A", to: "A", label: "retry" }],
            },
        });

        expect(result).toContain("A_loop_");
        expect(result).toContain("A --> A_loop_");
        expect(result).toContain("A_loop_");
        expect(result).not.toMatch(/\n\s*A\s*-->\s*A\s*(\n|$)/);
    });

    it("handles different node shapes", () => {
        const result = generateMermaidFromJSON({
            diagramType: "flowchart",
            payload: {
                nodes: [
                    { id: "A", label: "Round", shape: "rounded" },
                    { id: "B", label: "Diamond", shape: "diamond" },
                ],
                edges: [],
            },
        });
        expect(result).not.toBeNull();
        expect(result.length).toBeGreaterThan(0);
    });

    it("generates a typed sequence diagram", () => {
        const result = generateMermaidFromJSON({
            diagramType: "sequenceDiagram",
            title: "API flow",
            payload: {
                participants: [
                    { id: "user", label: "User", kind: "actor" },
                    { id: "api", label: "API" },
                ],
                messages: [
                    { from: "user", to: "api", text: "Request", kind: "sync" },
                ],
            },
        });
        expect(result).toContain("sequenceDiagram");
        expect(result).toContain('actor user as "User"');
        expect(result).toContain("user->>api: Request");
    });

    it("infers sequence participants from messages when participants are omitted", () => {
        const result = generateMermaidFromJSON({
            diagramType: "sequenceDiagram",
            payload: {
                messages: [
                    { from: "user", to: "api", text: "Request" },
                    { from: "api", to: "db", text: "Query", kind: "async" },
                ],
            },
        });

        expect(result).toContain("sequenceDiagram");
        expect(result).toContain('participant user as "user"');
        expect(result).toContain('participant api as "api"');
        expect(result).toContain('participant db as "db"');
        expect(result).toContain("api->>db: Query");
    });

    it("supports alternate sequence json keys like actors/interactions", () => {
        const result = generateMermaidFromJSON({
            diagramType: "sequenceDiagram",
            payload: {
                actors: [{ name: "Frontend", role: "actor" }, { name: "Backend" }],
                interactions: [
                    { source: "Frontend", target: "Backend", message: "POST /chat" },
                    { source: "Backend", target: "Frontend", message: "200 OK", type: "reply" },
                ],
            },
        });

        expect(result).toContain("sequenceDiagram");
        expect(result).toContain('actor Frontend as "Frontend"');
        expect(result).toContain("Backend-->>Frontend: 200 OK");
    });

    it("accepts 'sequence' as a mermaid-json diagramType alias", () => {
        const result = generateMermaidFromJSON({
            diagramType: "sequence",
            payload: {
                participants: [{ id: "u", label: "User", kind: "actor" }, { id: "s", label: "Service" }],
                messages: [{ from: "u", to: "s", text: "Call" }],
            },
        });

        expect(result).toContain("sequenceDiagram");
        expect(result).toContain('actor u as "User"');
    });

    it("generates a typed mindmap", () => {
        const result = generateMermaidFromJSON({
            diagramType: "mindmap",
            payload: {
                root: {
                    label: "RepoMind",
                    children: [{ label: "API" }, { label: "UI" }],
                },
            },
        });
        expect(result).toContain("mindmap");
        expect(result).toContain("RepoMind");
        expect(result).toContain("API");
        expect(result).not.toContain("root((");
    });

    it("generates a typed state diagram with a single start arrow", () => {
        const result = generateMermaidFromJSON({
            diagramType: "stateDiagram-v2",
            payload: {
                initialState: "idle",
                states: [
                    { id: "idle", label: "Idle", kind: "start" },
                    { id: "active", label: "Active" },
                    { id: "done", label: "Done", kind: "end" },
                ],
                transitions: [
                    { from: "idle", to: "active", label: "run" },
                    { from: "active", to: "done", label: "finish" },
                ],
            },
        });

        expect(result).toContain("stateDiagram-v2");
        expect(result).toContain('state "Idle" as idle');
        expect(result).toContain("[*] --> idle");
        expect(result).toContain("done --> [*]");
        expect(result?.match(/\[\*\] --> idle/g)?.length).toBe(1);
    });

    it("rewrites direct state self-loops through an intermediate state", () => {
        const result = generateMermaidFromJSON({
            diagramType: "stateDiagram-v2",
            payload: {
                states: [{ id: "active", label: "Active", kind: "start" }],
                transitions: [{ from: "active", to: "active", label: "retry" }],
            },
        });

        expect(result).toContain("active_loop_");
        expect(result).toContain("active --> active_loop_");
        expect(result).toContain("active_loop_1 --> active");
        expect(result).not.toContain("active --> active: retry");
    });

    it("formats gantt tasks with a computed duration", () => {
        const result = generateMermaidFromJSON({
            diagramType: "gantt",
            payload: {
                dateFormat: "YYYY-MM-DD",
                sections: [
                    {
                        name: "Planning",
                        tasks: [
                            { id: "kickoff", label: "Kickoff", start: "2026-03-20", end: "2026-03-21" },
                        ],
                    },
                ],
            },
        });

        expect(result).toContain("gantt");
        expect(result).toContain("section Planning");
        expect(result).toContain("Kickoff");
        expect(result).toContain("1d");
    });

    it("returns null for invalid payloads", () => {
        const result = generateMermaidFromJSON({ diagramType: "gantt", payload: {} });
        expect(result).toBeNull();
    });

    it("generates a typed xychart with mixed series", () => {
        const result = generateMermaidFromJSON({
            diagramType: "xychart",
            payload: {
                orientation: "horizontal",
                xAxis: { title: "Month", categories: ["Jan", "Feb", "Mar"] },
                yAxis: { title: "Commits", min: 0, max: 20 },
                series: [
                    { type: "bar", values: [6, 11, 9] },
                    { type: "line", values: [5, 9, 12] },
                ],
            },
        });

        expect(result).toContain("xychart horizontal");
        expect(result).toContain('x-axis "Month" [Jan, Feb, Mar]');
        expect(result).toContain('y-axis "Commits" 0 --> 20');
        expect(result).toContain("bar [6, 11, 9]");
        expect(result).toContain("line [5, 9, 12]");
    });

    it("accepts xychart-beta as a legacy diagramType alias in mermaid-json", () => {
        const result = generateMermaidFromJSON({
            diagramType: "xychart-beta",
            payload: {
                series: [{ type: "line", values: [1, 2, 3] }],
            },
        });

        expect(result).toContain("xychart");
        expect(result).not.toContain("xychart-beta");
    });

    it("rejects xychart series when category length does not match values", () => {
        const result = generateMermaidFromJSON({
            diagramType: "xychart",
            payload: {
                xAxis: { categories: ["Jan", "Feb"] },
                series: [{ type: "line", values: [1, 2, 3] }],
            },
        });

        expect(result).toBeNull();
    });
});

describe("templates", () => {
    it("basicFlow generates valid output for given components", () => {
        const result = templates.basicFlow(["Client", "Server", "Database"]);
        expect(result).toContain("Client");
        expect(result).toContain("Server");
        expect(result).toContain("Database");
    });

    it("layeredArch generates output for given layers", () => {
        const result = templates.layeredArch(["Frontend", "Backend", "DB"]);
        expect(result).toContain("Frontend");
        expect(result).toContain("DB");
    });

    it("componentDiagram generates output with deps", () => {
        const result = templates.componentDiagram([
            { name: "AuthModule", deps: ["UserModule"] },
            { name: "UserModule" },
        ]);
        expect(result).toContain("AuthModule");
        expect(result).toContain("UserModule");
    });
});
