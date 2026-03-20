import { describe, expect, it } from "vitest";
import { routeMermaidDiagram } from "@/lib/mermaid-router";

describe("routeMermaidDiagram", () => {
    it("routes explicit flowchart requests to mermaid-json", () => {
        const route = routeMermaidDiagram("Create a flowchart of the repo build pipeline");

        expect(route.visualIntent).toBe(true);
        expect(route.diagramType).toBe("flowchart");
        expect(route.renderMode).toBe("mermaid-json");
        expect(route.family).toBe("workflow");
    });

    it("routes architecture requests to flowchart mermaid-json", () => {
        const route = routeMermaidDiagram("Create an architecture diagram for this repo");

        expect(route.visualIntent).toBe(true);
        expect(route.diagramType).toBe("flowchart");
        expect(route.renderMode).toBe("mermaid-json");
        expect(route.family).toBe("architecture");
    });

    it("routes mind map requests to mermaid-json", () => {
        const route = routeMermaidDiagram("Create a mindmap of the repo modules");

        expect(route.visualIntent).toBe(true);
        expect(route.diagramType).toBe("mindmap");
        expect(route.renderMode).toBe("mermaid-json");
        expect(route.family).toBe("mindmap");
    });

    it("routes sequence requests to mermaid-json", () => {
        const route = routeMermaidDiagram("Show the API request response sequence");

        expect(route.visualIntent).toBe(true);
        expect(route.diagramType).toBe("sequenceDiagram");
        expect(route.renderMode).toBe("mermaid-json");
    });

    it("keeps vague diagram wording text-first", () => {
        const route = routeMermaidDiagram("draw a diagram");

        expect(route.visualIntent).toBe(false);
        expect(route.family).toBe("default");
        expect(route.diagramType).toBe("flowchart");
    });
});
