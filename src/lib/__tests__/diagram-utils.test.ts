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

    it("trims leading/trailing whitespace", () => {
        const result = sanitizeMermaidCode("  flowchart TD\n  A --> B  ");
        expect(result).toBe(result.trim());
    });

    it("returns passthrough for clean code", () => {
        const clean = "flowchart TD\n  A --> B";
        const result = sanitizeMermaidCode(clean);
        expect(result).toContain("flowchart");
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
        expect(result).toMatch(/flowchart|graph|sequenceDiagram|classDiagram/i);
    });
});

describe("generateMermaidFromJSON", () => {
    it("generates a basic flowchart with two nodes and one edge", () => {
        const result = generateMermaidFromJSON({
            nodes: [
                { id: "A", label: "Start" },
                { id: "B", label: "End" },
            ],
            edges: [{ from: "A", to: "B" }],
        });
        expect(result).toContain("graph"); // uses 'graph TD' syntax
        expect(result).toContain("Start");
        expect(result).toContain("End");
    });

    it("respects direction setting", () => {
        const result = generateMermaidFromJSON({
            direction: "LR",
            nodes: [{ id: "X", label: "Node" }],
            edges: [],
        });
        expect(result).toContain("LR");
    });

    it("includes edge labels when provided", () => {
        const result = generateMermaidFromJSON({
            nodes: [
                { id: "A", label: "Alpha" },
                { id: "B", label: "Beta" },
            ],
            edges: [{ from: "A", to: "B", label: "depends on" }],
        });
        expect(result).toContain("depends on");
    });

    it("handles different node shapes", () => {
        const result = generateMermaidFromJSON({
            nodes: [
                { id: "A", label: "Round", shape: "rounded" },
                { id: "B", label: "Diamond", shape: "diamond" },
            ],
            edges: [],
        });
        expect(result).not.toBeNull();
        expect(result.length).toBeGreaterThan(0);
    });

    it("handles empty nodes and edges gracefully", () => {
        const result = generateMermaidFromJSON({ nodes: [], edges: [] });
        expect(typeof result).toBe("string");
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
