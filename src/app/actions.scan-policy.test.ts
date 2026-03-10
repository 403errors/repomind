import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    authMock,
    isAdminUserMock,
    kvGetMock,
    kvIncrMock,
    kvExpireMock,
    getDefaultBranchHeadShaMock,
    getCachedSecurityScanResultMock,
    cacheSecurityScanResultMock,
    buildScanConfigMock,
    runSecurityScanMock,
    saveScanResultMock,
    saveScanFindingVerificationRecordsMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    isAdminUserMock: vi.fn(),
    kvGetMock: vi.fn(),
    kvIncrMock: vi.fn(),
    kvExpireMock: vi.fn(),
    getDefaultBranchHeadShaMock: vi.fn(),
    getCachedSecurityScanResultMock: vi.fn(),
    cacheSecurityScanResultMock: vi.fn(),
    buildScanConfigMock: vi.fn(),
    runSecurityScanMock: vi.fn(),
    saveScanResultMock: vi.fn(),
    saveScanFindingVerificationRecordsMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/admin-auth", () => ({
    isAdminUser: isAdminUserMock,
}));

vi.mock("@vercel/kv", () => ({
    kv: {
        get: kvGetMock,
        incr: kvIncrMock,
        expire: kvExpireMock,
    },
}));

vi.mock("@/lib/github", () => ({
    getProfile: vi.fn(),
    getRepo: vi.fn(),
    getDefaultBranchHeadSha: getDefaultBranchHeadShaMock,
    getRepoFileTree: vi.fn(),
    getFileContentBatch: vi.fn(),
    getProfileReadme: vi.fn(),
    getUserRepos: vi.fn(),
    getRepoReadme: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
    getCachedSecurityScanResult: getCachedSecurityScanResultMock,
    cacheSecurityScanResult: cacheSecurityScanResultMock,
}));

vi.mock("@/lib/services/security-service", () => ({
    buildScanConfig: buildScanConfigMock,
    runSecurityScan: runSecurityScanMock,
}));

vi.mock("@/lib/services/scan-storage", () => ({
    saveScanResult: saveScanResultMock,
    getLatestScanId: vi.fn(),
    getScanResultWithStatus: vi.fn(),
}));

vi.mock("@/lib/services/finding-verification-store", () => ({
    saveScanFindingVerificationRecords: saveScanFindingVerificationRecordsMock,
}));

function makeCoreResult(profile: "quick" | "deep") {
    return {
        findings: [],
        hiddenFindings: [],
        rejectedFindings: [],
        verificationRecords: [],
        summary: {
            total: 0,
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
        },
        grouped: {},
        meta: {
            depth: profile,
            analysisProfile: profile,
            aiAssist: "off" as const,
            aiEnabled: false,
            maxFiles: profile === "deep" ? 60 : 20,
            aiFilesSelected: 0,
            confidenceThreshold: profile === "deep" ? 0.68 : 0.78,
            durationMs: 10,
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
                verificationGateEnabled: false,
                verifiedOnlyReportsEnabled: false,
            },
        },
    };
}

vi.mock("@/lib/analytics", () => ({
    trackEvent: vi.fn(),
    trackAuthenticatedQueryEvent: vi.fn(),
    getPublicStats: vi.fn(),
    trackReportConversionEvent: vi.fn(),
    resetReportConversionMetrics: vi.fn(),
}));

vi.mock("@/lib/services/query-pipeline", () => ({
    executeRepoQuery: vi.fn(),
    executeRepoQueryStream: vi.fn(),
}));

vi.mock("@/lib/services/history-service", () => ({
    recordSearch: vi.fn(),
    getRecentSearches: vi.fn(),
}));

vi.mock("@/lib/services/artifact-service", () => ({
    searchRepositoryCode: vi.fn(),
}));

vi.mock("@/lib/services/scan-share-links", () => ({
    createScanShareLink: vi.fn(),
    resolveScanFromShareToken: vi.fn(),
}));

vi.mock("@/lib/domain", () => ({
    toProfileContext: vi.fn(),
    buildProfileContextString: vi.fn(),
    buildRepoReadmeEntry: vi.fn(),
}));

vi.mock("@/lib/gemini", () => ({
    answerWithContext: vi.fn(),
    answerWithContextStream: vi.fn(),
}));

vi.mock("@/lib/profile-stream", () => ({
    mapProfileStreamChunk: vi.fn(),
}));

vi.mock("@/lib/services/report-service", () => ({
    buildOutreachPack: vi.fn(),
    findingFingerprint: vi.fn(),
}));

vi.mock("@/lib/site-url", () => ({
    getPublicSiteUrl: vi.fn(() => "https://repomind.in"),
}));

vi.mock("@/lib/session-guard", () => ({
    getSessionUserId: vi.fn(),
}));

vi.mock("@/lib/services/report-access", () => ({
    canAccessPrivateReport: vi.fn(),
}));

vi.mock("@/lib/services/report-false-positives", () => ({
    createFalsePositiveSubmission: vi.fn(),
    updateFalsePositiveStatus: vi.fn(),
}));

vi.mock("@/lib/services/fix-verification", () => ({
    finalizeFixVerificationRun: vi.fn(),
    startFixVerificationRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
    prisma: {
        user: {
            findUnique: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

import { getRemainingDeepScans, scanRepositoryVulnerabilities } from "@/app/actions";

describe("scan policy updates", () => {
    beforeEach(() => {
        authMock.mockReset();
        isAdminUserMock.mockReset();
        kvGetMock.mockReset();
        kvIncrMock.mockReset();
        kvExpireMock.mockReset();
        getDefaultBranchHeadShaMock.mockReset();
        getCachedSecurityScanResultMock.mockReset();
        cacheSecurityScanResultMock.mockReset();
        buildScanConfigMock.mockReset();
        runSecurityScanMock.mockReset();
        saveScanResultMock.mockReset();
        saveScanFindingVerificationRecordsMock.mockReset();

        authMock.mockResolvedValue({ user: { id: "user_1" } });
        isAdminUserMock.mockReturnValue(false);
        kvGetMock.mockResolvedValue(0);
        kvIncrMock.mockResolvedValue(1);
        kvExpireMock.mockResolvedValue(1);
        getDefaultBranchHeadShaMock.mockResolvedValue("abc123");
        getCachedSecurityScanResultMock.mockResolvedValue(null);
        cacheSecurityScanResultMock.mockResolvedValue(undefined);
        runSecurityScanMock.mockImplementation(async (_owner, _repo, _files, config) => makeCoreResult(config.analysisProfile));
        saveScanResultMock.mockResolvedValue("scan_1");
        saveScanFindingVerificationRecordsMock.mockResolvedValue(undefined);
        buildScanConfigMock.mockImplementation((options: { analysisProfile?: "quick" | "deep"; depth?: "quick" | "deep"; aiAssist?: "off" | "on" } = {}) => {
            const analysisProfile = options.analysisProfile ?? options.depth ?? "quick";
            return {
                depth: analysisProfile,
                analysisProfile,
                maxFiles: analysisProfile === "deep" ? 60 : 20,
                aiAssist: options.aiAssist ?? "off",
                aiEnabled: options.aiAssist === "on",
                aiMaxFiles: analysisProfile === "deep" ? 30 : 12,
                confidenceThreshold: analysisProfile === "deep" ? 0.68 : 0.78,
                includePatterns: [],
                excludePatterns: [],
                includeMatchers: [],
                excludeMatchers: [],
                selectedPaths: null,
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
            };
        });
    });

    it("does not consume deep quota when returning a cached result (even at limit)", async () => {
        getCachedSecurityScanResultMock.mockResolvedValue(makeCoreResult("deep"));
        kvGetMock.mockResolvedValue(15);

        const result = await scanRepositoryVulnerabilities(
            "acme",
            "widget",
            [{ path: "src/a.ts", sha: "1" }],
            { analysisProfile: "deep" }
        );

        expect(result.meta.fromCache).toBe(true);
        expect(runSecurityScanMock).not.toHaveBeenCalled();
        expect(kvIncrMock).not.toHaveBeenCalled();
        expect(kvExpireMock).not.toHaveBeenCalled();
    });

    it("enforces deep limit at 15 for fresh scans", async () => {
        getCachedSecurityScanResultMock.mockResolvedValue(null);
        kvGetMock.mockResolvedValue(15);

        await expect(scanRepositoryVulnerabilities(
            "acme",
            "widget",
            [{ path: "src/a.ts", sha: "1" }],
            { analysisProfile: "deep" }
        )).rejects.toThrow("Monthly Deep Scan limit reached (15/15).");

        expect(runSecurityScanMock).not.toHaveBeenCalled();
        expect(kvIncrMock).not.toHaveBeenCalled();
    });

    it("increments deep quota only on fresh deep scans", async () => {
        getCachedSecurityScanResultMock.mockResolvedValue(null);
        kvGetMock.mockResolvedValue(3);

        await scanRepositoryVulnerabilities(
            "acme",
            "widget",
            [{ path: "src/a.ts", sha: "1" }],
            { analysisProfile: "deep" }
        );

        expect(runSecurityScanMock).toHaveBeenCalledOnce();
        expect(cacheSecurityScanResultMock).toHaveBeenCalledOnce();
        expect(kvIncrMock).toHaveBeenCalledOnce();
        expect(kvExpireMock).toHaveBeenCalledOnce();
    });

    it("keeps quick scans unrestricted by monthly quota", async () => {
        authMock.mockResolvedValue(null);
        getCachedSecurityScanResultMock.mockResolvedValue(null);

        await expect(scanRepositoryVulnerabilities(
            "acme",
            "widget",
            [{ path: "src/a.ts", sha: "1" }],
            { analysisProfile: "quick" }
        )).resolves.toEqual(expect.objectContaining({
            meta: expect.objectContaining({ analysisProfile: "quick" }),
        }));

        expect(kvIncrMock).not.toHaveBeenCalled();
    });

    it("returns deep-scan total as 15 in remaining-quota response", async () => {
        kvGetMock.mockResolvedValue(4);

        const data = await getRemainingDeepScans();

        expect(data).toEqual(expect.objectContaining({
            used: 4,
            total: 15,
            isUnlimited: false,
        }));
    });
});
