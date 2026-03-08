import { describe, it, expect } from "vitest";
import {
    normalizePatterns,
    buildMatchers,
    matchesAny,
    scorePathRisk,
    extractSnippet,
    deduplicateFindings,
    buildScanConfig,
    filterCodeFiles,
} from "@/lib/services/security-service";
import type { SecurityFinding } from "@/lib/security-scanner";

describe("normalizePatterns", () => {
    it("returns empty array for undefined", () => {
        expect(normalizePatterns(undefined)).toEqual([]);
    });

    it("returns the same array when given strings", () => {
        expect(normalizePatterns(["*.ts", "*.js"])).toEqual(["*.ts", "*.js"]);
    });
});

describe("buildMatchers", () => {
    it("returns an array of RegExp objects", () => {
        const matchers = buildMatchers(["src/.*\\.ts", "test/.*"]);
        expect(matchers.every(m => m instanceof RegExp)).toBe(true);
    });

    it("returns empty array for empty patterns", () => {
        expect(buildMatchers([])).toEqual([]);
    });
});

describe("matchesAny", () => {
    it("returns true when path matches at least one pattern", () => {
        const matchers = buildMatchers(["src/auth.*"]);
        expect(matchesAny("src/auth.ts", matchers)).toBe(true);
    });

    it("returns false when no pattern matches", () => {
        const matchers = buildMatchers(["test/.*"]);
        expect(matchesAny("src/auth.ts", matchers)).toBe(false);
    });

    it("returns false for empty matchers array", () => {
        expect(matchesAny("any/file.ts", [])).toBe(false);
    });
});

describe("scorePathRisk", () => {
    it("gives higher scores to high-risk paths", () => {
        const authScore = scorePathRisk("src/auth/middleware.ts");
        const readmeScore = scorePathRisk("README.md");
        expect(authScore).toBeGreaterThan(readmeScore);
    });

    it("gives high score to crypto-related files", () => {
        const score = scorePathRisk("lib/crypto-utils.ts");
        expect(score).toBeGreaterThan(0);
    });

    it("returns a number", () => {
        expect(typeof scorePathRisk("src/index.ts")).toBe("number");
    });
});

describe("extractSnippet", () => {
    const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7";

    it("extracts surrounding lines around the target line", () => {
        const snippet = extractSnippet(content, 4);
        expect(snippet).toContain("line4");
    });

    it("returns content from the start when line is undefined", () => {
        const snippet = extractSnippet(content, undefined);
        // When no line is given, returns beginning lines of content
        expect(typeof snippet).toBe("string");
        expect(snippet).toContain("line1");
    });

    it("handles edge cases (line 1)", () => {
        const snippet = extractSnippet(content, 1);
        expect(snippet).toContain("line1");
    });

    it("handles last line", () => {
        const snippet = extractSnippet(content, 7);
        expect(snippet).toContain("line7");
    });
});

describe("deduplicateFindings", () => {
    const makeFinding = (file: string, line: number, title: string): SecurityFinding => ({
        type: "code",
        severity: "high",
        title,
        description: "test",
        file,
        line,
        recommendation: "fix it",
    });

    it("removes duplicate findings by file + line + title", () => {
        const findings = [
            makeFinding("a.ts", 10, "SQL Injection"),
            makeFinding("a.ts", 10, "SQL Injection"),
            makeFinding("a.ts", 11, "SQL Injection"),
        ];
        const deduped = deduplicateFindings(findings);
        expect(deduped.length).toBe(2);
    });

    it("preserves unique findings", () => {
        const findings = [
            makeFinding("a.ts", 10, "Issue A"),
            makeFinding("b.ts", 10, "Issue A"),
            makeFinding("a.ts", 20, "Issue B"),
        ];
        const deduped = deduplicateFindings(findings);
        expect(deduped.length).toBe(3);
    });

    it("handles empty array", () => {
        expect(deduplicateFindings([])).toEqual([]);
    });
});

describe("buildScanConfig", () => {
    it("returns a config with defaults when called with empty options", () => {
        const config = buildScanConfig({});
        expect(config.depth).toBeDefined();
        expect(config.maxFiles).toBeGreaterThan(0);
        expect(config.aiEnabled).toBe(false);
        expect(config.analysisProfile).toBe("quick");
    });

    it("respects provided depth option", () => {
        const quickConfig = buildScanConfig({ depth: "quick" });
        const deepConfig = buildScanConfig({ depth: "deep" });
        expect(quickConfig.depth).toBe("quick");
        expect(deepConfig.depth).toBe("deep");
        expect(quickConfig.maxFiles).toBe(20);
        expect(deepConfig.maxFiles).toBe(60);
    });

    it("respects maxFiles option", () => {
        const config = buildScanConfig({ maxFiles: 25 });
        expect(config.maxFiles).toBe(25);
    });

    it("sets aiEnabled from enableAi option", () => {
        const enabled = buildScanConfig({ enableAi: true });
        const disabled = buildScanConfig({ enableAi: false });
        expect(enabled.aiEnabled).toBe(true);
        expect(disabled.aiEnabled).toBe(false);
    });

    it("supports aiAssist option explicitly", () => {
        const config = buildScanConfig({ aiAssist: "on" });
        expect(config.aiAssist).toBe("on");
        expect(config.aiEnabled).toBe(true);
    });
});

describe("filterCodeFiles", () => {
    const config = buildScanConfig({});

    it("returns only files matching code extensions by default", () => {
        const files = [
            { path: "src/app.ts" },
            { path: "public/logo.png" },
            { path: "src/utils.js" },
            { path: "package-lock.json" },
        ];
        const filtered = filterCodeFiles(files, config);
        // Should include .ts and .js, exclude image and lock
        expect(filtered.some(f => f.path === "src/app.ts")).toBe(true);
        expect(filtered.some(f => f.path === "public/logo.png")).toBe(false);
    });

    it("respects maxFiles limit", () => {
        const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/file${i}.ts` }));
        const limitedConfig = buildScanConfig({ maxFiles: 10 });
        const filtered = filterCodeFiles(files, limitedConfig);
        expect(filtered.length).toBeLessThanOrEqual(10);
    });

    it("handles empty file list", () => {
        expect(filterCodeFiles([], config)).toEqual([]);
    });
});
