import { describe, expect, it } from "vitest";
import type { SecurityFinding } from "@/lib/security-scanner";
import type { StoredScan } from "@/lib/services/scan-storage";
import {
    buildFindingChatPrompt,
    buildOutreachPack,
    buildReportViewData,
    computePriorScanDiff,
    findingFingerprint,
    rankFindingsForTriage,
} from "@/lib/services/report-service";

function makeFinding(overrides: Partial<SecurityFinding>): SecurityFinding {
    return {
        type: "code",
        severity: "medium",
        title: "Potential SQL Injection",
        description: "User-controlled input reaches a SQL string concatenation sink.",
        file: "src/api/users.ts",
        recommendation: "Use parameterized queries.",
        ...overrides,
    };
}

describe("findingFingerprint", () => {
    it("normalizes casing and whitespace for deterministic matching", () => {
        const a = makeFinding({
            title: "  Potential   SQL Injection ",
            description: "User-controlled input reaches a SQL string concatenation sink.",
        });
        const b = makeFinding({
            title: "potential sql injection",
            description: "  user-controlled input reaches a sql string concatenation sink. ",
        });

        expect(findingFingerprint(a)).toBe(findingFingerprint(b));
    });
});

describe("computePriorScanDiff", () => {
    it("computes new/resolved/unchanged counts", () => {
        const shared = makeFinding({});
        const resolved = makeFinding({ file: "src/legacy.ts", title: "Unsafe eval() usage" });
        const added = makeFinding({ file: "src/new.ts", title: "Hardcoded Secret" });

        const diff = computePriorScanDiff([shared, added], [shared, resolved]);
        expect(diff).toEqual({ new: 1, resolved: 1, unchanged: 1 });
    });

    it("treats all current findings as new when no previous scan exists", () => {
        const current = [makeFinding({}), makeFinding({ file: "src/auth.ts", title: "Auth Bypass" })];
        const diff = computePriorScanDiff(current, null);
        expect(diff).toEqual({ new: 2, resolved: 0, unchanged: 0 });
    });
});

describe("rankFindingsForTriage", () => {
    it("prioritizes high-severity/high-confidence exploitable findings first", () => {
        const critical = makeFinding({
            severity: "critical",
            confidence: "high",
            title: "Command Injection",
            description: "Unsanitized shell command execution",
            file: "src/api/admin.ts",
        });
        const medium = makeFinding({
            severity: "medium",
            confidence: "high",
            title: "Potential XSS",
            description: "Potential reflected XSS",
            file: "src/ui/render.tsx",
        });
        const low = makeFinding({
            severity: "low",
            confidence: "medium",
            title: "Info leak",
            file: "src/log.ts",
        });

        const ranked = rankFindingsForTriage([medium, low, critical]);
        expect(ranked[0]).toBe(critical);
        expect(ranked[2]).toBe(low);
    });

    it("sorts by exploitability tag before severity tie-breakers", () => {
        const mediumExploit = makeFinding({
            severity: "critical",
            confidence: "high",
            title: "Critical but medium exploitability",
            exploitabilityTag: "medium",
            file: "src/security/check.ts",
        });
        const highExploit = makeFinding({
            severity: "high",
            confidence: "medium",
            title: "High exploitability path traversal",
            exploitabilityTag: "high",
            file: "src/http/files.ts",
        });

        const ranked = rankFindingsForTriage([mediumExploit, highExploit]);
        expect(ranked[0]).toBe(highExploit);
        expect(ranked[1]).toBe(mediumExploit);
    });
});

describe("buildReportViewData", () => {
    it("returns top fixes, diff summary, and evidence-first finding views", () => {
        const scan: StoredScan = {
            id: "scan-1",
            owner: "acme",
            repo: "widget",
            timestamp: Date.now(),
            expiresAt: Date.now() + 60_000,
            depth: "quick",
            summary: {
                total: 2,
                critical: 1,
                high: 0,
                medium: 1,
                low: 0,
                info: 0,
            },
            findings: [
                makeFinding({ severity: "critical", confidence: "high", title: "Hardcoded Secret" }),
                makeFinding({ severity: "medium", confidence: "medium", title: "Potential XSS", file: "src/ui.tsx" }),
            ],
        };

        const previous: StoredScan = {
            ...scan,
            id: "scan-0",
            findings: [makeFinding({ severity: "critical", confidence: "high", title: "Hardcoded Secret" })],
        };

        const view = buildReportViewData(scan, previous);
        expect(view.topFixes.length).toBe(2);
        expect(view.priorScanDiff).toEqual({ new: 1, resolved: 0, unchanged: 1 });
        expect(view.findingViews.length).toBe(2);
        expect(view.globalChatHref).toContain("/chat?q=acme%2Fwidget");
        expect(view.globalFixPrompt).toContain("Address all findings in one coordinated pass.");
        expect(view.globalFixPrompt).toContain("Hardcoded Secret");
        expect(view.globalFixPrompt).toContain("Potential XSS");
        expect(view.findingViews[0].chatHref).toContain("/chat?q=acme%2Fwidget");
        expect(view.findingViews[0].fixPrompt).toContain("## Vulnerability");
        expect(view.findingViews[0].proof.length).toBeGreaterThan(0);
        expect(view.findingViews[0].impact.length).toBeGreaterThan(0);
        expect(view.findingViews[0].confidenceRationale).toContain("Confidence:");
    });
});

describe("buildFindingChatPrompt", () => {
    it("includes snippet, secure target behavior, and testing instructions", () => {
        const finding = makeFinding({
            severity: "high",
            line: 42,
            snippet: "42| db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);",
            ruleId: "sqli-tainted-dynamic-query",
            confidence: "high",
            confidenceScore: 0.92,
            evidence: [{ type: "sink", message: "query sink receives tainted input", line: 42 }],
        });

        const prompt = buildFindingChatPrompt("acme", "widget", finding);
        expect(prompt).toContain("## Vulnerability");
        expect(prompt).toContain("## Proof");
        expect(prompt).toContain("## Impact");
        expect(prompt).toContain("## Desired Secure Behavior");
        expect(prompt).toContain("## What to produce");
        expect(prompt).toContain("Regression tests");
        expect(prompt).toContain("SELECT * FROM users");
    });
});

describe("buildOutreachPack", () => {
    it("creates a private-first outreach message with strongest finding and CTA", () => {
        const scan: StoredScan = {
            id: "scan-10",
            owner: "acme",
            repo: "widget",
            timestamp: Date.now(),
            expiresAt: Date.now() + 60_000,
            depth: "deep",
            summary: {
                total: 2,
                critical: 1,
                high: 1,
                medium: 0,
                low: 0,
                info: 0,
            },
            findings: [
                makeFinding({
                    title: "Authentication Bypass",
                    severity: "critical",
                    confidence: "high",
                    file: "src/app/api/admin/route.ts",
                }),
                makeFinding({
                    title: "Potential XSS",
                    severity: "high",
                    confidence: "high",
                    file: "src/components/Profile.tsx",
                }),
            ],
        };

        const outreach = buildOutreachPack(scan, "https://repomind.in/report/shared/token123");
        expect(outreach.maintainerNote).toContain("Hello acme Team");
        expect(outreach.strongestFinding?.finding.title).toBe("Authentication Bypass");
        expect(outreach.shareUrl).toContain("/report/shared/");
        expect(outreach.outreachMessage).toContain("One finding that stood out was");
        expect(outreach.outreachMessage).toContain("Private Disclosure Report");
        expect(outreach.outreachMessage).toContain("Repo Profile: https://repomind.in/repo/acme/widget");
    });
});
