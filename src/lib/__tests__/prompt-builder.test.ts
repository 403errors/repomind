import { describe, it, expect } from "vitest";
import { buildRepoMindPrompt, formatHistoryText, resolveVisualOutputDecision } from "@/lib/prompt-builder";

describe("buildRepoMindPrompt", () => {
    const baseParams = {
        question: "What does this repo do?",
        context: "package.json: { name: 'myapp' }",
        repoDetails: { owner: "octocat", repo: "myproject" },
        historyText: "",
    };

    it("contains the user's question", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).toContain("What does this repo do?");
    });

    it("includes the repository owner and name", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).toContain("octocat");
        expect(result).toContain("myproject");
    });

    it("includes the full GitHub URL", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).toContain("https://github.com/octocat/myproject");
    });

    it("includes the context string", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).toContain("package.json");
    });

    it("includes conversation history when provided", () => {
        const result = buildRepoMindPrompt({
            ...baseParams,
            historyText: "User: Hello\n\nRepoMind: Hi there",
        });
        expect(result).toContain("User: Hello");
        expect(result).toContain("RepoMind: Hi there");
    });

    it("returns a non-empty string", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(100);
    });

    it("includes RepoMind persona instructions", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).toContain("RepoMind");
    });

    it("keeps non-visual prompts text-first", () => {
        const result = buildRepoMindPrompt(baseParams);

        expect(result).toContain("Prefer markdown tables for comparisons and structured summaries.");
        expect(result).not.toContain("mermaid-json");
        expect(result).not.toContain("SVG");
    });

    it("uses mermaid-json for complex flowchart requests", () => {
        const result = buildRepoMindPrompt({
            ...baseParams,
            question: "Create a detailed flowchart for this repo",
        });

        expect(result).toContain("Primary output format: **MERMAID-JSON**");
        expect(result).toContain("15-20");
        expect(result).toContain("50");
        expect(result).toContain("markdown tables instead of diagrams");
    });

    it("uses mermaid-json for a supported non-flowchart diagram type", () => {
        const result = buildRepoMindPrompt({
            ...baseParams,
            question: "Create a mindmap of the repo modules",
        });

        expect(result).toContain("mindmap");
        expect(result).toContain("```mermaid-json```");
        expect(result).toContain('"diagramType": "mindmap"');
    });

    it("defaults pie-chart style prompts to mermaid-json under standard complexity", () => {
        const result = buildRepoMindPrompt({
            ...baseParams,
            question: "Create a pie chart for module distribution",
        });

        expect(result).toContain("Primary output format: **MERMAID-JSON**");
        expect(result).toContain("Fallback output format: **SVG**");
    });

    it("keeps the static prompt template free of emoji characters", () => {
        const result = buildRepoMindPrompt(baseParams);
        expect(result).not.toMatch(/\p{Extended_Pictographic}/u);
    });
});

describe("resolveVisualOutputDecision", () => {
    it("honors explicit svg requests", () => {
        const decision = resolveVisualOutputDecision("Generate an SVG architecture diagram");
        expect(decision.primaryFormat).toBe("svg");
        expect(decision.fallbackFormat).toBe("mermaid-json");
    });

    it("honors explicit mermaid requests", () => {
        const decision = resolveVisualOutputDecision("Show this as mermaid flow");
        expect(decision.primaryFormat).toBe("mermaid");
    });

    it("routes typed diagrams to mermaid-json", () => {
        const decision = resolveVisualOutputDecision("Create a sequence diagram for API calls");
        expect(decision.primaryFormat).toBe("mermaid-json");
    });

    it("routes visual polish prompts to svg", () => {
        const decision = resolveVisualOutputDecision("Create a beautiful architecture diagram");
        expect(decision.primaryFormat).toBe("svg");
    });

    it("routes complex requests to mermaid-json", () => {
        const decision = resolveVisualOutputDecision("Create a complex distributed workflow diagram");
        expect(decision.primaryFormat).toBe("mermaid-json");
    });

    it("routes simple requests to svg", () => {
        const decision = resolveVisualOutputDecision("Create a simple process flow diagram");
        expect(decision.primaryFormat).toBe("svg");
    });

    it("routes standard architecture requests to svg", () => {
        const decision = resolveVisualOutputDecision("Create an architecture diagram for this repo");
        expect(decision.primaryFormat).toBe("svg");
    });
});

describe("formatHistoryText", () => {
    it("returns empty string for empty history", () => {
        expect(formatHistoryText([])).toBe("");
    });

    it("formats a single user message", () => {
        const result = formatHistoryText([
            { role: "user", content: "Hello, world!" },
        ]);
        expect(result).toContain("User: Hello, world!");
    });

    it("formats a single model message", () => {
        const result = formatHistoryText([
            { role: "model", content: "Hi back!" },
        ]);
        expect(result).toContain("RepoMind: Hi back!");
    });

    it("formats multi-turn conversation with separator", () => {
        const result = formatHistoryText([
            { role: "user", content: "Q1" },
            { role: "model", content: "A1" },
            { role: "user", content: "Q2" },
        ]);
        expect(result).toContain("User: Q1");
        expect(result).toContain("RepoMind: A1");
        expect(result).toContain("User: Q2");
    });

    it("uses correct labels for each role", () => {
        const result = formatHistoryText([
            { role: "user", content: "x" },
            { role: "model", content: "y" },
        ]);
        expect(result).toMatch(/User:/);
        expect(result).toMatch(/RepoMind:/);
    });
});
