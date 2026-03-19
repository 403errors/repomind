import { FixVerificationRunStatus, type Prisma } from "@prisma/client";

import { getFileContent, getRepoFileTree } from "@/lib/github";
import { runSecurityBenchmarkSuite } from "@/lib/security-benchmark-corpus";
import { runScanEngineV2, type SecurityFinding } from "@/lib/security-scanner";
import {
    SECURITY_VERIFICATION_FLAGS,
    SECURITY_VERIFICATION_THRESHOLDS,
} from "@/lib/security-verification-config";
import { prisma } from "@/lib/db";
import {
    closeFindingLifecycleByFingerprint,
    createFixVerificationRun,
    getFixVerificationRun,
    getLatestOpenVerificationByFingerprint,
    updateFixVerificationRun,
} from "@/lib/services/finding-verification-store";
import { buildScanConfig, runSecurityScan } from "@/lib/services/security-service";
import { verifyDetectedFindings } from "@/lib/services/security-verification";
import { findingFingerprint as buildFindingFingerprint } from "@/lib/services/report-service";

export interface FinalizeFixVerificationResult {
    runId: string;
    closed: boolean;
    reasons: string[];
}

export interface FixVerificationDeps {
    fetchFileTree?: typeof getRepoFileTree;
    fetchFileContent?: typeof getFileContent;
    runRegressionSuite?: typeof runSecurityBenchmarkSuite;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

async function runTargetedRescan(params: {
    owner: string;
    repo: string;
    scanId: string;
    findingFingerprint: string;
    changedFiles: string[];
    deps: FixVerificationDeps;
}): Promise<{ passed: boolean; findingCount: number; findings: SecurityFinding[] }> {
    const fetchTree = params.deps.fetchFileTree ?? getRepoFileTree;
    const fetchContent = params.deps.fetchFileContent ?? getFileContent;
    const tree = await fetchTree(params.owner, params.repo);
    const blobMap = new Map(
        tree.tree
            .filter((node) => node.type === "blob")
            .map((node) => [node.path, node.sha])
    );

    const targetPaths = params.changedFiles.filter((path) => blobMap.has(path));
    if (targetPaths.length === 0) {
        return {
            passed: false,
            findingCount: 0,
            findings: [],
        };
    }

    const fetched = await Promise.all(
        targetPaths.map(async (path) => {
            try {
                const content = await fetchContent(params.owner, params.repo, path, blobMap.get(path));
                if (!content) return null;
                return { path, content };
            } catch {
                return null;
            }
        })
    );

    const filesWithContent = fetched.filter((file): file is { path: string; content: string } => Boolean(file));
    if (filesWithContent.length === 0) {
        return {
            passed: false,
            findingCount: 0,
            findings: [],
        };
    }

    const detection = await runScanEngineV2(filesWithContent, {
        profile: "deep",
        confidenceThreshold: 0,
    });
    const verification = await verifyDetectedFindings({
        scanId: params.scanId,
        owner: params.owner,
        repo: params.repo,
        findings: detection.findings,
    });

    const hasFingerprint = verification.verifiedFindings.some(
        (finding) => buildFindingFingerprint(finding) === params.findingFingerprint
    );

    return {
        passed: !hasFingerprint,
        findingCount: verification.verifiedFindings.length,
        findings: verification.verifiedFindings,
    };
}

async function runFallbackFullRescan(params: {
    owner: string;
    repo: string;
    findingFingerprint: string;
    deps: FixVerificationDeps;
}): Promise<{ passed: boolean; findings: SecurityFinding[] }> {
    const fetchTree = params.deps.fetchFileTree ?? getRepoFileTree;
    const tree = await fetchTree(params.owner, params.repo);
    const files = tree.tree
        .filter((node) => node.type === "blob")
        .map((node) => ({ path: node.path, sha: node.sha }));

    const config = buildScanConfig({
        analysisProfile: "deep",
        aiAssist: "off",
    });
    const full = await runSecurityScan(params.owner, params.repo, files, config);
    const hasFingerprint = full.findings.some(
        (finding) => buildFindingFingerprint(finding) === params.findingFingerprint
    );

    return {
        passed: !hasFingerprint,
        findings: full.findings,
    };
}

export async function startFixVerificationRun(
    findingFingerprint: string,
    changedFiles: string[],
    options: {
        scanId?: string;
        requestedByUserId?: string | null;
    } = {}
): Promise<{ runId: string }> {
    if (options.scanId) {
        const scan = await prisma.repoScan.findUnique({
            where: { id: options.scanId },
            select: { id: true, owner: true, repo: true },
        });
        if (!scan) {
            throw new Error("Scan not found for fix verification run.");
        }

        const run = await createFixVerificationRun({
            scanId: scan.id,
            findingFingerprint,
            owner: scan.owner,
            repo: scan.repo,
            changedFiles,
            requestedByUserId: options.requestedByUserId ?? null,
        });

        return { runId: run.id };
    }

    const reference = await getLatestOpenVerificationByFingerprint(findingFingerprint);
    if (!reference) {
        throw new Error("No open verified finding available for this fingerprint.");
    }

    const run = await createFixVerificationRun({
        scanId: reference.scanId,
        findingFingerprint,
        owner: reference.owner,
        repo: reference.repo,
        changedFiles,
        requestedByUserId: options.requestedByUserId ?? null,
    });

    return { runId: run.id };
}

export async function finalizeFixVerificationRun(
    runId: string,
    deps: FixVerificationDeps = {}
): Promise<FinalizeFixVerificationResult> {
    const run = await getFixVerificationRun(runId);
    if (!run) {
        throw new Error("Fix verification run not found.");
    }

    await updateFixVerificationRun(runId, {
        status: FixVerificationRunStatus.RUNNING,
    });

    const reasons: string[] = [];
    const changedFiles = asStringArray(run.changedFiles);

    const regression = (deps.runRegressionSuite ?? runSecurityBenchmarkSuite)(0.5);
    const regressionPassed =
        regression.precision >= SECURITY_VERIFICATION_THRESHOLDS.benchmarkPrecision &&
        regression.recall >= SECURITY_VERIFICATION_THRESHOLDS.benchmarkRecall;
    if (!regressionPassed) {
        reasons.push(
            `Regression gate failed (precision=${regression.precision.toFixed(2)}, recall=${regression.recall.toFixed(2)}).`
        );
    }

    const targeted = await runTargetedRescan({
        owner: run.owner,
        repo: run.repo,
        scanId: run.scanId,
        findingFingerprint: run.findingFingerprint,
        changedFiles,
        deps,
    });
    if (!targeted.passed) {
        reasons.push("Targeted rescan still detected the finding or changed files were unavailable.");
    }

    const shouldRunFullRescan =
        !targeted.passed ||
        changedFiles.length === 0 ||
        targeted.findings.some((finding) => finding.severity === "critical" || finding.severity === "high");

    let fullRescanPassed: boolean | null = null;
    if (shouldRunFullRescan) {
        const full = await runFallbackFullRescan({
            owner: run.owner,
            repo: run.repo,
            findingFingerprint: run.findingFingerprint,
            deps,
        });
        fullRescanPassed = full.passed;
        if (!full.passed) {
            reasons.push("Fallback full deep rescan still detected the finding fingerprint.");
        }
    }

    const closed =
        regressionPassed &&
        targeted.passed &&
        (!shouldRunFullRescan || fullRescanPassed === true);

    if (closed && SECURITY_VERIFICATION_FLAGS.autoClosureGate) {
        const closedCount = await closeFindingLifecycleByFingerprint({
            owner: run.owner,
            repo: run.repo,
            findingFingerprint: run.findingFingerprint,
        });
        if (closedCount === 0) {
            reasons.push("No open lifecycle records were found to auto-close.");
        }
    }

    await updateFixVerificationRun(runId, {
        status: closed ? FixVerificationRunStatus.PASSED : FixVerificationRunStatus.FAILED,
        regressionTestsPassed: regressionPassed,
        regressionSummary: `precision=${regression.precision.toFixed(3)}, recall=${regression.recall.toFixed(3)}`,
        targetedRescanPassed: targeted.passed,
        targetedRescanFindings: targeted.findingCount,
        fullRescanTriggered: shouldRunFullRescan,
        fullRescanPassed: fullRescanPassed,
        closeReasons: reasons as unknown as Prisma.JsonArray,
        finalizedAt: new Date(),
        autoSignedOffAt: closed ? new Date() : null,
    });

    return {
        runId,
        closed,
        reasons,
    };
}
