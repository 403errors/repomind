import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SecurityFinding } from "@/lib/security-scanner";
import { findingFingerprint as buildFindingFingerprint } from "@/lib/services/report-service";

const {
    getFixVerificationRunMock,
    updateFixVerificationRunMock,
    closeFindingLifecycleByFingerprintMock,
    getLatestOpenVerificationByFingerprintMock,
    createFixVerificationRunMock,
    getRepoFileTreeMock,
    getFileContentMock,
    verifyDetectedFindingsMock,
    runSecurityScanMock,
} = vi.hoisted(() => ({
    getFixVerificationRunMock: vi.fn(),
    updateFixVerificationRunMock: vi.fn(),
    closeFindingLifecycleByFingerprintMock: vi.fn(),
    getLatestOpenVerificationByFingerprintMock: vi.fn(),
    createFixVerificationRunMock: vi.fn(),
    getRepoFileTreeMock: vi.fn(),
    getFileContentMock: vi.fn(),
    verifyDetectedFindingsMock: vi.fn(),
    runSecurityScanMock: vi.fn(),
}));

vi.mock("@/lib/services/finding-verification-store", () => ({
    getFixVerificationRun: getFixVerificationRunMock,
    updateFixVerificationRun: updateFixVerificationRunMock,
    closeFindingLifecycleByFingerprint: closeFindingLifecycleByFingerprintMock,
    getLatestOpenVerificationByFingerprint: getLatestOpenVerificationByFingerprintMock,
    createFixVerificationRun: createFixVerificationRunMock,
}));

vi.mock("@/lib/github", () => ({
    getRepoFileTree: getRepoFileTreeMock,
    getFileContent: getFileContentMock,
}));

vi.mock("@/lib/services/security-verification", () => ({
    verifyDetectedFindings: verifyDetectedFindingsMock,
}));

vi.mock("@/lib/services/security-service", () => ({
    buildScanConfig: vi.fn(() => ({ analysisProfile: "deep" })),
    runSecurityScan: runSecurityScanMock,
}));

import {
    finalizeFixVerificationRun,
    startFixVerificationRun,
} from "@/lib/services/fix-verification";

function makeRun(overrides: Record<string, unknown> = {}) {
    return {
        id: "run_1",
        scanId: "scan_1",
        findingFingerprint: "fp_1",
        owner: "acme",
        repo: "widget",
        changedFiles: ["src/api.ts"],
        ...overrides,
    };
}

describe("fix verification flow", () => {
    beforeEach(() => {
        getFixVerificationRunMock.mockReset();
        updateFixVerificationRunMock.mockReset();
        closeFindingLifecycleByFingerprintMock.mockReset();
        getLatestOpenVerificationByFingerprintMock.mockReset();
        createFixVerificationRunMock.mockReset();
        getRepoFileTreeMock.mockReset();
        getFileContentMock.mockReset();
        verifyDetectedFindingsMock.mockReset();
        runSecurityScanMock.mockReset();

        closeFindingLifecycleByFingerprintMock.mockResolvedValue(1);
        getRepoFileTreeMock.mockResolvedValue({
            tree: [{ path: "src/api.ts", type: "blob", sha: "sha1" }],
            hiddenFiles: [],
        });
        getFileContentMock.mockResolvedValue("export function handler(req){ return 'ok'; }");
        verifyDetectedFindingsMock.mockResolvedValue({
            verifiedFindings: [],
            hiddenFindings: [],
            rejectedFindings: [],
            records: [],
            stats: {
                detected: 0,
                verifiedTrue: 0,
                rejectedFalse: 0,
                inconclusiveHidden: 0,
                canaryApplied: true,
                verificationGateEnabled: true,
                verifiedOnlyReportsEnabled: true,
            },
        });
        runSecurityScanMock.mockResolvedValue({
            findings: [],
            hiddenFindings: [],
            rejectedFindings: [],
            verificationRecords: [],
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            grouped: {},
            meta: {
                depth: "deep",
                analysisProfile: "deep",
                aiAssist: "off",
                aiEnabled: false,
                maxFiles: 60,
                aiFilesSelected: 0,
                confidenceThreshold: 0.68,
                durationMs: 1,
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
                fromCache: false,
                timings: {},
                analyzerStats: {},
                verifierStats: {
                    detected: 0,
                    verifiedTrue: 0,
                    rejectedFalse: 0,
                    inconclusiveHidden: 0,
                    canaryApplied: true,
                    verificationGateEnabled: true,
                    verifiedOnlyReportsEnabled: true,
                },
            },
        });
    });

    it("starts a fix verification run from latest open fingerprint", async () => {
        getLatestOpenVerificationByFingerprintMock.mockResolvedValue({
            scanId: "scan_1",
            owner: "acme",
            repo: "widget",
            findingFingerprint: "fp_1",
        });
        createFixVerificationRunMock.mockResolvedValue({ id: "run_new" });

        const result = await startFixVerificationRun("fp_1", ["src/api.ts"]);
        expect(result.runId).toBe("run_new");
        expect(createFixVerificationRunMock).toHaveBeenCalled();
    });

    it("auto-closes when regression and rescans pass", async () => {
        getFixVerificationRunMock.mockResolvedValue(makeRun());

        const result = await finalizeFixVerificationRun("run_1", {
            runRegressionSuite: async () => ({ precision: 0.95, recall: 0.9, truePositiveCount: 5, falsePositiveCount: 0, falseNegativeCount: 0 }),
        });

        expect(result.closed).toBe(true);
        expect(closeFindingLifecycleByFingerprintMock).toHaveBeenCalledWith({
            owner: "acme",
            repo: "widget",
            findingFingerprint: "fp_1",
        });
        expect(updateFixVerificationRunMock).toHaveBeenCalled();
    });

    it("fails closure when finding reappears in targeted rescan", async () => {
        const finding: SecurityFinding = {
            type: "code",
            severity: "high",
            title: "SQL injection via tainted query construction",
            description: "Tainted input reaches query sink.",
            file: "src/api.ts",
            line: 12,
            recommendation: "Use parameterized queries.",
            cwe: "CWE-89",
            confidence: "high",
        };
        const fingerprint = buildFindingFingerprint(finding);
        getFixVerificationRunMock.mockResolvedValue(makeRun({ findingFingerprint: fingerprint }));
        verifyDetectedFindingsMock.mockResolvedValue({
            verifiedFindings: [finding],
            hiddenFindings: [],
            rejectedFindings: [],
            records: [],
            stats: {
                detected: 1,
                verifiedTrue: 1,
                rejectedFalse: 0,
                inconclusiveHidden: 0,
                canaryApplied: true,
                verificationGateEnabled: true,
                verifiedOnlyReportsEnabled: true,
            },
        });

        const result = await finalizeFixVerificationRun("run_1", {
            runRegressionSuite: async () => ({ precision: 0.95, recall: 0.9, truePositiveCount: 5, falsePositiveCount: 0, falseNegativeCount: 0 }),
        });

        expect(result.closed).toBe(false);
        expect(closeFindingLifecycleByFingerprintMock).not.toHaveBeenCalled();
    });
});
