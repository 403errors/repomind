import { describe, expect, it } from "vitest";

import { buildSecurityScanMessage, CACHED_SCAN_BANNER } from "@/components/chat/security-scan-message";
import type { SecurityFinding } from "@/lib/security-scanner";

const finding: SecurityFinding = {
    type: "code",
    severity: "high",
    title: "Potential SQL Injection",
    description: "User input reaches a query sink.",
    file: "src/api/query.ts",
    line: 42,
    recommendation: "Use parameterized queries.",
    confidence: "high",
};

describe("buildSecurityScanMessage", () => {
    it("prepends cached-result banner when no findings and response is from cache", () => {
        const message = buildSecurityScanMessage({
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            findings: [],
            isFromCache: true,
            maxFindingsPreview: 5,
        });

        expect(message).toContain(CACHED_SCAN_BANNER);
        expect(message).toContain("no verified security vulnerabilities");
    });

    it("prepends cached-result banner when findings exist and response is from cache", () => {
        const message = buildSecurityScanMessage({
            summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findings: [finding],
            isFromCache: true,
            maxFindingsPreview: 5,
        });

        expect(message).toContain(CACHED_SCAN_BANNER);
        expect(message).toContain("Here are the key findings:");
        expect(message).toContain("Potential SQL Injection");
    });

    it("does not prepend cached-result banner for fresh scan results", () => {
        const message = buildSecurityScanMessage({
            summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findings: [finding],
            isFromCache: false,
            maxFindingsPreview: 5,
        });

        expect(message).not.toContain(CACHED_SCAN_BANNER);
    });
});
