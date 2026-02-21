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
    scanFiles,
    getScanSummary,
    groupBySeverity,
    type SecurityFinding,
    type ScanSummary,
} from "@/lib/security-scanner";
import { analyzeCodeWithGemini } from "@/lib/gemini-security";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SecurityScanConfig {
    depth: "quick" | "deep";
    maxFiles: number;
    aiEnabled: boolean;
    aiMaxFiles: number;
    includeMatchers: RegExp[];
    excludeMatchers: RegExp[];
    selectedPaths: Set<string> | null;
}

export interface SecurityScanDeps {
    fetchFileContent?: (
        owner: string,
        repo: string,
        path: string,
        sha?: string
    ) => Promise<string>;
    runAiAnalysis?: (
        files: Array<{ path: string; content: string }>
    ) => Promise<SecurityFinding[]>;
}

// ─── Pure Helpers ──────────────────────────────────────────────────────────────

function normalizePatterns(patterns?: string[]): string[] {
    return (patterns ?? []).map((p) => p.trim()).filter(Boolean);
}

function buildMatchers(patterns: string[]): RegExp[] {
    return patterns.map((pattern) => {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
        return new RegExp(escaped, "i");
    });
}

function matchesAny(path: string, matchers: RegExp[]): boolean {
    return matchers.some((m) => m.test(path));
}

/** Rough risk score for prioritising files during AI analysis */
export function scorePathRisk(path: string): number {
    const RISK_KEYWORDS = [
        "auth", "login", "oauth", "jwt", "token", "session", "admin",
        "middleware", "api", "route", "controller", "db", "sql",
        "payment", "billing", "webhook", "crypto", "secret",
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

/** Deduplicate based on file + line + title */
export function deduplicateFindings(findings: SecurityFinding[]): SecurityFinding[] {
    const seen = new Set<string>();
    return findings.filter((f) => {
        const key = `${f.file}:${f.line ?? 0}:${f.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Build a structured config from raw scan options */
export function buildScanConfig(options: {
    depth?: "quick" | "deep";
    maxFiles?: number;
    enableAi?: boolean;
    aiMaxFiles?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    filePaths?: string[];
}): SecurityScanConfig {
    const depth = options.depth ?? "quick";
    return {
        depth,
        maxFiles: options.maxFiles ?? (depth === "deep" ? 60 : 20),
        aiEnabled: options.enableAi !== false,
        aiMaxFiles: options.aiMaxFiles ?? (depth === "deep" ? 25 : 10),
        includeMatchers: buildMatchers(normalizePatterns(options.includePatterns)),
        excludeMatchers: buildMatchers(normalizePatterns(options.excludePatterns)),
        selectedPaths: options.filePaths ? new Set(options.filePaths) : null,
    };
}

/** Filter file list to code files based on the scan config */
export function filterCodeFiles(
    files: Array<{ path: string; sha?: string }>,
    config: SecurityScanConfig
): Array<{ path: string; sha?: string }> {
    return files
        .filter(({ path }) => {
            const isCode =
                /\.(js|jsx|ts|tsx|py|java|php|rb|go|rs)$/i.test(path) ||
                path === "package.json";
            if (!isCode) return false;
            if (config.selectedPaths && !config.selectedPaths.has(path)) return false;
            if (config.includeMatchers.length > 0 && !matchesAny(path, config.includeMatchers))
                return false;
            if (config.excludeMatchers.length > 0 && matchesAny(path, config.excludeMatchers))
                return false;
            return true;
        })
        .slice(0, config.maxFiles);
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
    deps: SecurityScanDeps = {}
): Promise<{
    findings: SecurityFinding[];
    summary: ScanSummary & { debug?: Record<string, number> };
    grouped: Record<string, SecurityFinding[]>;
    meta: {
        depth: "quick" | "deep";
        aiEnabled: boolean;
        maxFiles: number;
        aiFilesSelected: number;
        durationMs: number;
    };
}> {
    const startedAt = Date.now();
    const fetchContent = deps.fetchFileContent ?? getFileContent;
    const runAi = deps.runAiAnalysis ?? analyzeCodeWithGemini;

    const codeFiles = filterCodeFiles(files, config);
    console.log(`🔍 Security Scan: ${codeFiles.length} code files selected`);

    // Fetch file contents
    const filesWithContent: Array<{ path: string; content: string }> = [];
    for (const file of codeFiles) {
        try {
            const content = await fetchContent(owner, repo, file.path, file.sha);
            if (typeof content === "string" && content.length > 0) {
                filesWithContent.push({ path: file.path, content });
            } else {
                console.warn(`⚠️ Skipping ${file.path}: empty or non-string content`);
            }
        } catch (e) {
            console.warn(`❌ Failed to fetch ${file.path}:`, e);
        }
    }

    console.log(`📄 Fetched ${filesWithContent.length} files`);

    // Pattern-based scan
    const patternFindings = scanFiles(filesWithContent);

    // AI-assisted scan
    let aiFindings: SecurityFinding[] = [];
    let aiFilesSelected = 0;

    if (config.aiEnabled) {
        try {
            const filesByRisk = [...filesWithContent].sort(
                (a, b) => scorePathRisk(b.path) - scorePathRisk(a.path)
            );
            const patternHitFiles = new Set(patternFindings.map((f) => f.file));

            // Prioritise files that already had pattern hits
            const aiCandidates: Array<{ path: string; content: string }> = [];
            for (const file of filesByRisk) {
                if (patternHitFiles.has(file.path)) aiCandidates.push(file);
            }
            for (const file of filesByRisk) {
                if (aiCandidates.length >= config.aiMaxFiles) break;
                if (!aiCandidates.find((f) => f.path === file.path)) aiCandidates.push(file);
            }

            const aiFiles = aiCandidates.slice(0, config.aiMaxFiles);
            aiFilesSelected = aiFiles.length;

            if (aiFiles.length > 0) {
                aiFindings = await runAi(aiFiles);
            }
        } catch (err) {
            console.warn("AI security analysis failed, using pattern results only:", err);
        }
    }

    const allFindings = deduplicateFindings([...patternFindings, ...aiFindings]);
    const filtered = allFindings.filter((f) => !f.confidence || f.confidence !== "low");
    const withSnippets = attachSnippets(filtered, filesWithContent);

    const summary = getScanSummary(filtered) as ScanSummary & { debug?: Record<string, number> };
    summary.debug = {
        filesReceived: files.length,
        codeFilesFiltered: codeFiles.length,
        filesSuccessfullyFetched: filesWithContent.length,
        patternFindings: patternFindings.length,
        aiFindings: aiFindings.length,
        afterDedup: allFindings.length,
        afterConfidenceFilter: filtered.length,
    };

    return {
        findings: withSnippets,
        summary,
        grouped: groupBySeverity(withSnippets),
        meta: {
            depth: config.depth,
            aiEnabled: config.aiEnabled,
            maxFiles: config.maxFiles,
            aiFilesSelected,
            durationMs: Date.now() - startedAt,
        },
    };
}
