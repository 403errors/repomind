import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
    useSession: () => ({ data: { user: { id: "user_1" } } }),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));

vi.mock("@/app/actions", () => ({
    submitReportFalsePositive: vi.fn(),
    trackReportConversion: vi.fn(),
}));

vi.mock("@/components/CodeBlock", () => ({
    CodeBlock: ({ value }: { value: string }) => <pre>{value}</pre>,
}));

vi.mock("@/components/LoginModal", () => ({
    LoginModal: () => null,
}));

vi.mock("@/app/report/[scan_id]/ShareButton", () => ({
    default: () => <div>Share Report</div>,
}));

vi.mock("@/app/report/[scan_id]/components/ExportButtons", () => ({
    ExportButtons: () => <div>Markdown PDF</div>,
}));

import { ReportContent } from "@/app/report/[scan_id]/ReportContent";

describe("ReportContent", () => {
    it("renders the top action bar and removes per-finding fix buttons", () => {
        const html = renderToStaticMarkup(
            <ReportContent
                scan={{
                    id: "scan_1",
                    owner: "acme",
                    repo: "widget",
                    timestamp: Date.now(),
                    expiresAt: Date.now() + 48 * 60 * 60 * 1000,
                    depth: "deep",
                    summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, info: 0 },
                    findings: [],
                    userId: "user_1",
                }}
                priorScanDiff={{ new: 1, resolved: 0, unchanged: 0 }}
                topFixes={[{
                    index: 0,
                    fingerprint: "fp-1",
                    triageScore: 120,
                    proof: "proof",
                    impact: "impact",
                    confidenceRationale: "Confidence: high",
                    fixPrompt: "legacy finding prompt",
                    chatHref: "/chat?q=acme%2Fwidget&prompt=legacy",
                    finding: {
                        type: "code",
                        severity: "critical",
                        title: "Hardcoded Secret",
                        description: "desc",
                        file: "src/api.ts",
                        line: 42,
                        recommendation: "Rotate the secret",
                        confidence: "high",
                    },
                }]}
                findingViews={[{
                    index: 0,
                    fingerprint: "fp-1",
                    triageScore: 120,
                    proof: "proof",
                    impact: "impact",
                    confidenceRationale: "Confidence: high",
                    fixPrompt: "legacy finding prompt",
                    chatHref: "/chat?q=acme%2Fwidget&prompt=legacy",
                    finding: {
                        type: "code",
                        severity: "critical",
                        title: "Hardcoded Secret",
                        description: "desc",
                        file: "src/api.ts",
                        line: 42,
                        recommendation: "Rotate the secret",
                        confidence: "high",
                    },
                }]}
                globalFixPrompt="fix all findings"
                globalChatHref="/chat?q=acme%2Fwidget&prompt=fix%20all"
                hasPreviousScan
                isSharedView={false}
                canShareReport
                canGenerateOutreach={false}
                shareMode="canonical"
                reportExpiresAt={Date.now() + 48 * 60 * 60 * 1000}
            />
        );

        expect(html).toContain("Get LLM-Ready Fix Prompt");
        expect(html).toContain("Talk to the Codebase");
        expect(html).toContain("Repository Profile");
        expect(html).toContain("Share Report");
        expect(html).toContain("data-testid=\"report-actions-navbar\"");
        expect(html).toContain("sticky top-0 z-50");
        expect(html).not.toContain("Copy Global Prompt");
        expect(html).not.toContain("Copy Fix Prompt");
        expect(html).not.toContain("Open Repo Chat");
        expect(html).not.toContain("Fix All in Repo Chat");
        expect(html).not.toContain(">Copy Prompt<");
        expect(html).not.toContain("Fix in Repo Chat");
    });
});
