/**
 * Security scan service — A1
 *
 * Extracted from actions.ts. Houses all security scanning orchestration
 * so actions.ts becomes a thin adapter.
 *
 * Pure helper functions are exported for unit testing without mocking
 * the environment. IO-bound functions (file fetching) accept injectable deps.
 */
import { getFileContent } from "@/lib/github";
import {
    runScanEngineV2,
    getScanSummary,
    groupBySeverity,
    type SecurityFinding,
    type ScanSummary,
} from "@/lib/security-scanner";
import { analyzeCodeWithGemini } from "@/lib/gemini-security";
import {
    DEFAULT_CONFIDENCE_THRESHOLD,
    SECURITY_CACHE_KEY_VERSION,
    SECURITY_ENGINE_VERSION,
    SECURITY_SCAN_FILE_LIMITS,
} from "@/lib/security-scan-config";
import {
    verifyDetectedFindings,
    type FindingVerificationRecord,
    type VerifierStats,
} from "@/lib/services/security-verification";

const DEPENDENCY_FILES = new Set(["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SecurityScanConfig {
    depth: "quick" | "deep";
    analysisProfile: "quick" | "deep";
    maxFiles: number;
    aiAssist: "off" | "on";
    aiEnabled: boolean;
    aiMaxFiles: number;
    confidenceThreshold: number;
    includePatterns: string[];
    excludePatterns: string[];
    includeMatchers: RegExp[];
    excludeMatchers: RegExp[];
    selectedPaths: Set<string> | null;
    engineVersion: string;
    cacheKeyVersion: string;
}

export interface SecurityScanDeps {
    fetchFileContent?: (
        owner: string,
        repo: string,
        path: string,
        sha?: string
    ) => Promise<string>;
    runAiAnalysis?: (
        files: Array<{ path: string; content: string }>,
        repoAllPaths: string[],
        candidatePaths?: string[]
    ) => Promise<SecurityFinding[]>;
}

// ─── Pure Helpers ──────────────────────────────────────────────────────────────

export function normalizePatterns(patterns?: string[]): string[] {
    return (patterns ?? []).map((p) => p.trim()).filter(Boolean);
}

export function buildMatchers(patterns: string[]): RegExp[] {
    return patterns.map((pattern) => {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
        return new RegExp(escaped, "i");
    });
}

export function matchesAny(path: string, matchers: RegExp[]): boolean {
    return matchers.some((m) => m.test(path));
}

/** Rough risk score for prioritising files during AI analysis */
export function scorePathRisk(path: string): number {
    const RISK_KEYWORDS = [
        "auth", "login", "oauth", "jwt", "token", "session", "admin",
        "middleware", "api", "route", "controller", "db", "sql",
        "payment", "billing", "webhook", "crypto", "secret", "password",
        "user", "account", "permission", "role", "acl", "gate",
    ];
    const lower = path.toLowerCase();
    return RISK_KEYWORDS.reduce((n, kw) => (lower.includes(kw) ? n + 1 : n), 0);
}

/** Extract surrounding lines around a finding for display */
export function extractSnippet(content: string, line?: number, radius = 3): string {
    const lines = content.split("\n");
    if (!lines.length) return "";
    const index = line && line > 0 ? Math.min(line - 1, lines.length - 1) : 0;
    const start = Math.max(0, index - radius);
    const end = Math.min(lines.length, index + radius + 1);
    return lines
        .slice(start, end)
        .map((text, i) => `${start + i + 1}| ${text}`)
        .join("\n");
}

/** Attach code snippets to findings for richer display */
export function attachSnippets(
    findings: SecurityFinding[],
    files: Array<{ path: string; content: string }>
): SecurityFinding[] {
    const fileMap = new Map(files.map((f) => [f.path, f.content]));
    return findings.map((finding) => {
        const content = fileMap.get(finding.file);
        return content ? { ...finding, snippet: extractSnippet(content, finding.line) } : finding;
    });
}

function findingScore(finding: SecurityFinding): number {
    if (typeof finding.confidenceScore === "number") return finding.confidenceScore;
    if (finding.confidence === "high") return 0.9;
    if (finding.confidence === "medium") return 0.72;
    if (finding.confidence === "low") return 0.45;
    return 0.7;
}

/** Deduplicate based on stable fingerprint first, then fallback key */
export function deduplicateFindings(findings: SecurityFinding[]): SecurityFinding[] {
    const seen = new Set<string>();
    return findings.filter((finding) => {
        const key = finding.fingerprint ?? `${finding.file}:${finding.line ?? 0}:${finding.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Build a structured config from raw scan options */
export function buildScanConfig(options: {
    depth?: "quick" | "deep";
    analysisProfile?: "quick" | "deep";
    maxFiles?: number;
    aiAssist?: "off" | "on";
    enableAi?: boolean;
    aiMaxFiles?: number;
    confidenceThreshold?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    selectedPaths?: string[];
    filePaths?: string[];
}): SecurityScanConfig {
    const analysisProfile = options.analysisProfile ?? options.depth ?? "quick";
    const includePatterns = normalizePatterns(options.includePatterns);
    const excludePatterns = normalizePatterns(options.excludePatterns);
    const selectedPaths = options.selectedPaths ?? options.filePaths;
    const aiAssist = options.aiAssist ?? (options.enableAi === true ? "on" : "off");

    const maxFiles = options.maxFiles ?? SECURITY_SCAN_FILE_LIMITS[analysisProfile];

    return {
        depth: analysisProfile,
        analysisProfile,
        maxFiles,
        aiAssist,
        aiEnabled: aiAssist === "on",
        aiMaxFiles: options.aiMaxFiles ?? Math.min(maxFiles, analysisProfile === "deep" ? 30 : 12),
        confidenceThreshold: options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD[analysisProfile],
        includePatterns,
        excludePatterns,
        includeMatchers: buildMatchers(includePatterns),
        excludeMatchers: buildMatchers(excludePatterns),
        selectedPaths: selectedPaths ? new Set(selectedPaths) : null,
        engineVersion: SECURITY_ENGINE_VERSION,
        cacheKeyVersion: SECURITY_CACHE_KEY_VERSION,
    };
}

function passesPathFilters(path: string, config: SecurityScanConfig): boolean {
    if (config.selectedPaths && !config.selectedPaths.has(path)) return false;
    if (config.includeMatchers.length > 0 && !matchesAny(path, config.includeMatchers)) return false;
    if (config.excludeMatchers.length > 0 && matchesAny(path, config.excludeMatchers)) return false;
    return true;
}

/** Filter file list to scannable code/config files (dependency files handled separately) */
export function filterCodeFiles(
    files: Array<{ path: string; sha?: string }>,
    config: SecurityScanConfig
): Array<{ path: string; sha?: string }> {
    return files
        .filter(({ path }) => {
            const isCodeOrConfig =
                /\.(js|jsx|ts|tsx|py|java|php|rb|go|rs)$/i.test(path) ||
                /\.(ya?ml|toml|json|env|ini|config|cfg)$/i.test(path) ||
                /\.env(\.|$)/i.test(path);
            if (!isCodeOrConfig) return false;
            if (DEPENDENCY_FILES.has(path)) return false;
            return passesPathFilters(path, config);
        })
        .slice(0, config.maxFiles);
}

export function selectDependencyFiles(
    files: Array<{ path: string; sha?: string }>,
    config: SecurityScanConfig,
    forceIncludeForAiAssist = false
): Array<{ path: string; sha?: string }> {
    return files.filter(({ path }) => {
        if (!DEPENDENCY_FILES.has(path)) return false;
        // Explicit excludes still win.
        if (config.excludeMatchers.length > 0 && matchesAny(path, config.excludeMatchers)) return false;
        if (forceIncludeForAiAssist) return true;
        return passesPathFilters(path, config);
    });
}

const SUPABASE_POLICY_PATH = /^supabase\/(migrations|sql|policies|schema)\/.+\.sql$/i;

export function selectSupabasePolicyFiles(
    files: Array<{ path: string; sha?: string }>,
    config: SecurityScanConfig,
    maxFiles: number
): Array<{ path: string; sha?: string }> {
    return files
        .filter(({ path }) => {
            if (!SUPABASE_POLICY_PATH.test(path)) return false;
            if (config.excludeMatchers.length > 0 && matchesAny(path, config.excludeMatchers)) return false;
            return true;
        })
        .slice(0, maxFiles);
}

// ─── Core Service ──────────────────────────────────────────────────────────────

/**
 * Run a full security scan on a repository.
 * Accepts optional injectable deps for testing without real API calls.
 */
export async function runSecurityScan(
    owner: string,
    repo: string,
    files: Array<{ path: string; sha?: string }>,
    config: SecurityScanConfig,
    deps: SecurityScanDeps = {},
    allFilePaths: string[] = []
): Promise<{
    findings: SecurityFinding[];
    hiddenFindings: SecurityFinding[];
    rejectedFindings: SecurityFinding[];
    verificationRecords: FindingVerificationRecord[];
    summary: ScanSummary & { debug?: Record<string, number> };
    grouped: Record<string, SecurityFinding[]>;
    meta: {
        depth: "quick" | "deep";
        analysisProfile: "quick" | "deep";
        aiAssist: "off" | "on";
        aiEnabled: boolean;
        maxFiles: number;
        aiFilesSelected: number;
        confidenceThreshold: number;
        durationMs: number;
        engineVersion: string;
        cacheKeyVersion: string;
        fromCache: boolean;
        timings: Record<string, number>;
        analyzerStats: Record<string, number>;
        verifierStats: VerifierStats;
    };
}> {
    const startedAt = Date.now();
    const fetchContent = deps.fetchFileContent ?? getFileContent;
    const runAi = deps.runAiAnalysis ?? analyzeCodeWithGemini;

    const riskSorted = [...files].sort((a, b) => scorePathRisk(b.path) - scorePathRisk(a.path));
    const codeFiles = filterCodeFiles(riskSorted, config);
    const dependencyFiles = selectDependencyFiles(riskSorted, config, config.aiEnabled);
    const policyContextCandidates = selectSupabasePolicyFiles(
        riskSorted,
        config,
        config.analysisProfile === "deep" ? 40 : 16
    );

    const selectedFiles = [...codeFiles];
    for (const file of dependencyFiles) {
        if (!selectedFiles.find((current) => current.path === file.path)) {
            selectedFiles.push(file);
        }
    }
    const selectedPaths = new Set(selectedFiles.map((file) => file.path));
    const additionalPolicyFiles = policyContextCandidates.filter((file) => !selectedPaths.has(file.path));

    console.log(
        `🔍 Security Scan [${config.analysisProfile}]: ${selectedFiles.length} files selected (code=${codeFiles.length}, deps=${dependencyFiles.length}, policy_ctx=${policyContextCandidates.length}, total=${files.length})`
    );

    const fetchStartedAt = Date.now();
    const fetchedFiles = await Promise.all(
        selectedFiles.map(async (file) => {
            try {
                const content = await fetchContent(owner, repo, file.path, file.sha);
                if (typeof content === "string" && content.length > 0) {
                    return { path: file.path, content };
                }
                return null;
            } catch (error) {
                console.warn(`❌ Failed to fetch ${file.path}:`, error);
                return null;
            }
        })
    );
    const filesWithContent = fetchedFiles.filter((file): file is { path: string; content: string } => Boolean(file));

    const fetchedPolicyFiles = await Promise.all(
        additionalPolicyFiles.map(async (file) => {
            try {
                const content = await fetchContent(owner, repo, file.path, file.sha);
                if (typeof content === "string" && content.length > 0) {
                    return { path: file.path, content };
                }
                return null;
            } catch (error) {
                console.warn(`❌ Failed to fetch policy context file ${file.path}:`, error);
                return null;
            }
        })
    );
    const policyFilesWithContent = fetchedPolicyFiles.filter(
        (file): file is { path: string; content: string } => Boolean(file)
    );
    const verificationContextFiles = Array.from(
        new Map([...filesWithContent, ...policyFilesWithContent].map((file) => [file.path, file])).values()
    );
    const fetchDurationMs = Date.now() - fetchStartedAt;

    const deterministicStartedAt = Date.now();
    const deterministic = await runScanEngineV2(filesWithContent, {
        profile: config.analysisProfile,
        confidenceThreshold: config.confidenceThreshold,
    });
    const deterministicFindings = deterministic.findings;
    const deterministicDurationMs = Date.now() - deterministicStartedAt;

    let aiFindings: SecurityFinding[] = [];
    let aiFilesSelected = 0;
    const aiStartedAt = Date.now();

    if (config.aiEnabled && filesWithContent.length > 0) {
        try {
            const candidateSet = new Set(deterministic.aiCandidateFiles);
            const prioritised: Array<{ path: string; content: string }> = [];

            for (const file of filesWithContent) {
                if (candidateSet.has(file.path)) {
                    prioritised.push(file);
                }
            }
            for (const file of filesWithContent) {
                if (!prioritised.find((item) => item.path === file.path)) {
                    prioritised.push(file);
                }
            }

            const aiFiles = prioritised.slice(0, config.aiMaxFiles);
            aiFilesSelected = aiFiles.length;

            if (aiFiles.length > 0) {
                aiFindings = await runAi(
                    aiFiles,
                    allFilePaths.length > 0 ? allFilePaths : files.map((file) => file.path),
                    deterministic.aiCandidateFiles
                );
            }
        } catch (error) {
            console.warn("AI security analysis failed, using deterministic results only:", error);
        }
    }

    const allFindings = deduplicateFindings([...deterministicFindings, ...aiFindings]);
    const filtered = allFindings.filter((finding) => findingScore(finding) >= config.confidenceThreshold);
    const withSnippets = attachSnippets(filtered, filesWithContent);
    const verification = await verifyDetectedFindings({
        scanId: `${owner}/${repo}:${Date.now()}`,
        owner,
        repo,
        findings: withSnippets,
        repositoryFiles: verificationContextFiles,
        enableAiAdjudication: config.aiEnabled,
    });

    const summary = getScanSummary(verification.verifiedFindings) as ScanSummary & { debug?: Record<string, number> };
    summary.debug = {
        filesReceived: files.length,
        codeFilesFiltered: codeFiles.length,
        dependencyFilesIncluded: dependencyFiles.length,
        filesSuccessfullyFetched: filesWithContent.length,
        policyContextFilesFetched: policyFilesWithContent.length,
        patternFindings: deterministicFindings.length,
        deterministicFindings: deterministicFindings.length,
        aiFindings: aiFindings.length,
        afterDedup: allFindings.length,
        afterConfidenceFilter: filtered.length,
        verifiedVisibleFindings: verification.verifiedFindings.length,
        hiddenInconclusiveFindings: verification.hiddenFindings.length,
        rejectedFindings: verification.rejectedFindings.length,
    };

    return {
        findings: verification.verifiedFindings,
        hiddenFindings: verification.hiddenFindings,
        rejectedFindings: verification.rejectedFindings,
        verificationRecords: verification.records,
        summary,
        grouped: groupBySeverity(verification.verifiedFindings),
        meta: {
            depth: config.analysisProfile,
            analysisProfile: config.analysisProfile,
            aiAssist: config.aiAssist,
            aiEnabled: config.aiEnabled,
            maxFiles: config.maxFiles,
            aiFilesSelected,
            confidenceThreshold: config.confidenceThreshold,
            durationMs: Date.now() - startedAt,
            engineVersion: config.engineVersion,
            cacheKeyVersion: config.cacheKeyVersion,
            fromCache: false,
            timings: {
                fetchMs: fetchDurationMs,
                deterministicMs: deterministicDurationMs,
                aiMs: Date.now() - aiStartedAt,
            },
            analyzerStats: deterministic.analyzerStats,
            verifierStats: verification.stats,
        },
    };
}
