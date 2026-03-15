import type { SecurityFinding } from "@/lib/security-scanner";
import type { StoredScan } from "@/lib/services/scan-storage";

export interface PriorScanDiff {
    new: number;
    resolved: number;
    unchanged: number;
}

export interface ReportFindingView {
    index: number;
    finding: SecurityFinding;
    fingerprint: string;
    triageScore: number;
    proof: string;
    impact: string;
    confidenceRationale: string;
    fixPrompt: string;
    chatHref: string;
}

export interface ReportViewData {
    priorScanDiff: PriorScanDiff;
    topFixes: ReportFindingView[];
    findingViews: ReportFindingView[];
    globalFixPrompt: string;
    globalChatHref: string;
}

export interface OutreachPackData {
    maintainerNote: string;
    strongestFinding: ReportFindingView | null;
    impactStatement: string;
    shareUrl: string;
    outreachMessage: string;
}

const severityWeight: Record<SecurityFinding["severity"], number> = {
    critical: 100,
    high: 75,
    medium: 45,
    low: 20,
    info: 5,
};

const confidenceWeight: Record<NonNullable<SecurityFinding["confidence"]>, number> = {
    high: 20,
    medium: 10,
    low: 0,
};

const exploitabilityTagWeight: Record<NonNullable<SecurityFinding["exploitabilityTag"]>, number> = {
    high: 100,
    medium: 60,
    low: 25,
    unknown: 10,
};

function normalizeToken(input: string): string {
    return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function getFindingScore(finding: SecurityFinding): number {
    if (typeof finding.confidenceScore === "number") return finding.confidenceScore;
    if (finding.confidence === "high") return 0.9;
    if (finding.confidence === "medium") return 0.72;
    if (finding.confidence === "low") return 0.45;
    return 0.7;
}

function exploitabilityScore(finding: SecurityFinding): number {
    const text = normalizeToken(
        `${finding.title} ${finding.description} ${finding.recommendation} ${finding.type} ${finding.cwe ?? ""}`
    );

    let score = 0;

    if (
        /(remote code execution|rce|command injection|sql injection|auth bypass|privilege escalation|hardcoded secret|exposed.*token|unsafe child_process)/i.test(
            text
        )
    ) {
        score += 24;
    }

    if (/(injection|xss|ssrf|csrf|path traversal|deseriali[sz]ation|eval|exec|token|password|credential|secret)/i.test(text)) {
        score += 12;
    }

    if (finding.type === "secret") {
        score += 14;
    }

    const path = finding.file.toLowerCase();
    if (/(auth|login|middleware|api|route|controller|payment|billing|admin|token|session|crypto)/.test(path)) {
        score += 8;
    }

    if (typeof finding.cvss === "number") {
        score += Math.round(finding.cvss * 2);
    }

    return score;
}

function summarizeEvidence(finding: SecurityFinding): string[] {
    const output: string[] = [];

    if (Array.isArray(finding.evidence) && finding.evidence.length > 0) {
        output.push(...finding.evidence
            .slice(0, 3)
            .map((e) => `${e.message}${typeof e.line === "number" ? ` (line ${e.line})` : ""}`));
    }

    if (Array.isArray(finding.verificationSignals) && finding.verificationSignals.length > 0) {
        output.push(...finding.verificationSignals
            .slice(0, 3)
            .map((signal) => `Verifier ${signal.name}: ${signal.passed ? "pass" : "fail"} (${signal.detail})`));
    }

    if (output.length > 0) return output;

    return [
        `Detector rule: ${finding.ruleId ?? "unlabeled"}${finding.engine ? ` (${finding.engine})` : ""}.`,
    ];
}

function buildFindingProof(finding: SecurityFinding): string {
    const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
    const evidence = summarizeEvidence(finding)
        .map((item) => `- ${item}`)
        .join("\n");

    return [
        `Location: \`${location}\`.`,
        evidence,
    ].join("\n");
}

function buildImpactStatement(finding: SecurityFinding): string {
    const text = normalizeToken(`${finding.title} ${finding.description} ${finding.recommendation}`);
    const path = finding.file.toLowerCase();

    if (finding.type === "secret") {
        return "Exposed credentials can allow unauthorized service access and downstream compromise until keys are rotated.";
    }
    if (/(auth|authorization|permission|session|token|unauth|bypass)/i.test(text) || /(auth|session|token|api\/)/.test(path)) {
        return "Attackers may bypass intended access controls and invoke privileged workflows, increasing abuse and quota-exhaustion risk.";
    }
    if (/sql injection/.test(text)) {
        return "A crafted input could alter database queries, potentially exposing or mutating data outside intended query boundaries.";
    }
    if (/command injection|exec|child_process/.test(text)) {
        return "Tainted input at execution sinks can lead to arbitrary command execution in the server runtime.";
    }
    if (/xss|cross-site scripting|innerhtml|dangerouslysetinnerhtml/.test(text)) {
        return "Injected client-side script can steal session context, manipulate UI state, or perform actions on behalf of users.";
    }
    if (/path traversal/.test(text)) {
        return "An attacker could read or access files outside intended directories by controlling path segments.";
    }
    if (finding.severity === "critical" || finding.severity === "high") {
        return "This finding has high exploitability and should be remediated quickly to reduce direct security exposure.";
    }
    return "This issue weakens security posture and can become a higher-risk exploit path when combined with other weaknesses.";
}

function buildConfidenceRationale(finding: SecurityFinding): string {
    const score = getFindingScore(finding);
    const pct = Math.round(score * 100);
    const evidenceCount = Array.isArray(finding.evidence) ? finding.evidence.length : 0;
    const evidenceText = evidenceCount > 0 ? `${evidenceCount} evidence signal${evidenceCount === 1 ? "" : "s"}` : "rule match";
    const verificationLabel = finding.verificationStatus
        ? ` Verification: ${finding.verificationStatus}${finding.gateDecision ? ` / gate=${finding.gateDecision}` : ""}.`
        : "";
    const verificationScore = typeof finding.verificationScore === "number"
        ? ` Verifier score: ${Math.round(finding.verificationScore * 100)}%.`
        : "";

    return `Confidence: ${finding.confidence ?? "unlabeled"} (${pct}%). Source: ${finding.engine ?? "scanner"}${finding.ruleId ? ` / ${finding.ruleId}` : ""} with ${evidenceText}.${verificationLabel}${verificationScore}`;
}

export function findingFingerprint(finding: SecurityFinding): string {
    const descriptionSignature = normalizeToken(finding.description).slice(0, 120);
    return [
        normalizeToken(finding.type),
        normalizeToken(finding.file),
        normalizeToken(finding.title),
        normalizeToken(finding.cwe ?? ""),
        descriptionSignature,
    ].join("|");
}

export function scoreFindingForTriage(finding: SecurityFinding): number {
    const baseSeverity = severityWeight[finding.severity] ?? 0;
    const confidence = finding.confidence ? confidenceWeight[finding.confidence] : 8;
    const exploitabilityTagScore = exploitabilityTagWeight[finding.exploitabilityTag ?? "unknown"] ?? 0;
    return baseSeverity + confidence + exploitabilityScore(finding) + exploitabilityTagScore;
}

export function rankFindingsForTriage(findings: SecurityFinding[]): SecurityFinding[] {
    return [...findings].sort((a, b) => {
        const exploitabilityDelta =
            (exploitabilityTagWeight[b.exploitabilityTag ?? "unknown"] ?? 0) -
            (exploitabilityTagWeight[a.exploitabilityTag ?? "unknown"] ?? 0);
        if (exploitabilityDelta !== 0) return exploitabilityDelta;

        const scoreDelta = scoreFindingForTriage(b) - scoreFindingForTriage(a);
        if (scoreDelta !== 0) return scoreDelta;

        const severityDelta = (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0);
        if (severityDelta !== 0) return severityDelta;

        const fileDelta = a.file.localeCompare(b.file);
        if (fileDelta !== 0) return fileDelta;

        return (a.line ?? 0) - (b.line ?? 0);
    });
}

export function computePriorScanDiff(
    currentFindings: SecurityFinding[],
    previousFindings: SecurityFinding[] | null | undefined
): PriorScanDiff {
    const currentSet = new Set(currentFindings.map(findingFingerprint));

    if (!previousFindings || previousFindings.length === 0) {
        return {
            new: currentSet.size,
            resolved: 0,
            unchanged: 0,
        };
    }

    const previousSet = new Set(previousFindings.map(findingFingerprint));

    let unchanged = 0;
    currentSet.forEach((fp) => {
        if (previousSet.has(fp)) unchanged += 1;
    });

    return {
        new: Math.max(0, currentSet.size - unchanged),
        resolved: Math.max(0, previousSet.size - unchanged),
        unchanged,
    };
}

function truncateSnippet(snippet?: string, maxLength = 1400): string {
    if (!snippet) return "Snippet unavailable. Use file/line context to inspect the exact sink.";
    if (snippet.length <= maxLength) return snippet;
    return `${snippet.slice(0, maxLength)}\n... (truncated)`;
}

export function buildFindingChatPrompt(owner: string, repo: string, finding: SecurityFinding): string {
    const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
    const proof = buildFindingProof(finding);
    const impact = buildImpactStatement(finding);
    const confidenceRationale = buildConfidenceRationale(finding);
    const snippet = truncateSnippet(finding.snippet);

    return [
        `You are helping fix a security vulnerability in ${owner}/${repo}.`,
        "",
        "## Vulnerability",
        `- Title: ${finding.title}`,
        `- Severity: ${finding.severity.toUpperCase()}`,
        `- Location: ${location}`,
        `- CWE: ${finding.cwe ?? "Not mapped"}`,
        "",
        "## Proof",
        proof,
        "",
        "## Impact",
        impact,
        "",
        "## Confidence",
        confidenceRationale,
        "",
        "## Existing Recommendation",
        finding.recommendation,
        "",
        "## Code Context",
        "```",
        snippet,
        "```",
        "",
        "## Desired Secure Behavior",
        "- Enforce strict input validation/sanitization at source boundaries.",
        "- Ensure dangerous sinks only receive trusted/normalized values.",
        "- Preserve existing business behavior while removing the exploit path.",
        "",
        "## What to produce",
        "1. A minimal patch for the vulnerable file(s).",
        "2. Regression tests covering: exploit attempt, valid input, and edge cases.",
        "3. A short verification checklist (how to confirm the issue is fixed).",
    ].join("\n");
}

export function buildFindingChatHref(owner: string, repo: string, finding: SecurityFinding): string {
    const query = `${owner}/${repo}`;
    const prompt = buildFindingChatPrompt(owner, repo, finding);
    return `/chat?q=${encodeURIComponent(query)}&prompt=${encodeURIComponent(prompt)}`;
}

function summarizeSeverityTotals(scan: StoredScan): string {
    return [
        `${scan.summary.critical} critical`,
        `${scan.summary.high} high`,
        `${scan.summary.medium} medium`,
        `${scan.summary.low} low`,
        `${scan.summary.info} info`,
    ].join(", ");
}

function buildGlobalFindingSection(view: ReportFindingView): string {
    return [
        `### ${view.finding.title}`,
        `- Severity: ${view.finding.severity.toUpperCase()}`,
        `- Type: ${view.finding.type}`,
        `- Location: ${view.finding.file}${view.finding.line ? `:${view.finding.line}` : ""}`,
        `- Confidence: ${view.finding.confidence ?? "unscored"}`,
        `- Verification: ${view.finding.verificationStatus ?? "legacy-unverified"}${view.finding.gateDecision ? ` (${view.finding.gateDecision})` : ""}`,
        `- Exploitability: ${view.finding.exploitabilityTag ?? "unknown"}`,
        `- Proof:\n${view.proof}`,
        `- Impact: ${view.impact}`,
        `- Recommendation: ${view.finding.recommendation}`,
        view.finding.snippet
            ? [
                "- Code Context:",
                "```",
                truncateSnippet(view.finding.snippet, 900),
                "```",
            ].join("\n")
            : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildGlobalFixPrompt(scan: StoredScan, findingViews: ReportFindingView[]): string {
    const scanDate = new Date(scan.timestamp).toLocaleString();

    if (findingViews.length === 0) {
        return [
            `You are reviewing the security scan for ${scan.owner}/${scan.repo}.`,
            "",
            "The latest scan reported no findings that require remediation.",
            "",
            "## Scan Context",
            `- Depth: ${scan.depth === "deep" ? "Deep Analysis" : "Quick Scan"}`,
            `- Generated: ${scanDate}`,
            `- Summary: ${summarizeSeverityTotals(scan)}`,
            "",
            "## What to produce",
            "1. Confirm that no code changes are required.",
            "2. Suggest any follow-up verification checks that would improve confidence.",
        ].join("\n");
    }

    const findingsBlock = findingViews
        .map((view, index) => [
            `## Finding ${index + 1}`,
            buildGlobalFindingSection(view),
        ].join("\n"))
        .join("\n\n");

    return [
        `You are helping remediate the full security report for ${scan.owner}/${scan.repo}.`,
        "",
        "Address all findings in one coordinated pass.",
        "",
        "## Scan Context",
        `- Depth: ${scan.depth === "deep" ? "Deep Analysis" : "Quick Scan"}`,
        `- Generated: ${scanDate}`,
        `- Severity Summary: ${summarizeSeverityTotals(scan)}`,
        `- Total Findings: ${findingViews.length}`,
        "",
        "## Remediation Goal",
        "- Fix every confirmed issue in this report.",
        "- Preserve existing product behavior while removing exploit paths.",
        "- Group related fixes when they share the same root cause.",
        "- Add regression coverage for each issue cluster and the most important edge cases.",
        "",
        findingsBlock,
        "",
        "## What to produce",
        "1. A minimal patch that resolves all findings.",
        "2. Regression tests covering exploit attempts, valid behavior, and edge cases for each issue cluster.",
        "3. A short verification checklist for confirming the repo is fixed end-to-end.",
    ].join("\n");
}

export function buildGlobalChatHref(owner: string, repo: string, prompt: string): string {
    return `/chat?q=${encodeURIComponent(`${owner}/${repo}`)}&prompt=${encodeURIComponent(prompt)}`;
}

function buildRepoProfileHref(owner: string, repo: string): string {
    return `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function buildAbsoluteUrlFromOrigin(baseUrl: string, relativePath: string): string {
    try {
        return new URL(relativePath, new URL(baseUrl).origin).toString();
    } catch {
        return relativePath;
    }
}

export function buildReportViewData(scan: StoredScan, previousScan?: StoredScan | null): ReportViewData {
    const eligibleEntries = scan.findings
        .map((finding, index) => ({ finding, index }))
        .filter(({ finding }) => {
            if (!finding.verificationStatus) return true;
            return finding.verificationStatus === "AUTO_VERIFIED_TRUE" && finding.gateDecision !== "exclude";
        });
    const eligibleFindings = eligibleEntries.map((entry) => entry.finding);

    const rankedWithIndexes = eligibleEntries
        .map(({ finding, index }) => ({ finding, index, triageScore: scoreFindingForTriage(finding) }))
        .sort((a, b) => {
            const exploitabilityDelta =
                (exploitabilityTagWeight[b.finding.exploitabilityTag ?? "unknown"] ?? 0) -
                (exploitabilityTagWeight[a.finding.exploitabilityTag ?? "unknown"] ?? 0);
            if (exploitabilityDelta !== 0) return exploitabilityDelta;

            const scoreDelta = b.triageScore - a.triageScore;
            if (scoreDelta !== 0) return scoreDelta;
            const severityDelta = (severityWeight[b.finding.severity] ?? 0) - (severityWeight[a.finding.severity] ?? 0);
            if (severityDelta !== 0) return severityDelta;
            return a.index - b.index;
        });

    const findingViews = rankedWithIndexes.map(({ finding, index, triageScore }) => ({
        index,
        finding,
        fingerprint: findingFingerprint(finding),
        triageScore,
        proof: buildFindingProof(finding),
        impact: buildImpactStatement(finding),
        confidenceRationale: buildConfidenceRationale(finding),
        fixPrompt: buildFindingChatPrompt(scan.owner, scan.repo, finding),
        chatHref: buildFindingChatHref(scan.owner, scan.repo, finding),
    }));

    const previousEligible = previousScan?.findings?.filter((finding) => {
        if (!finding.verificationStatus) return true;
        return finding.verificationStatus === "AUTO_VERIFIED_TRUE" && finding.gateDecision !== "exclude";
    }) ?? null;
    const priorScanDiff = computePriorScanDiff(eligibleFindings, previousEligible);
    const globalFixPrompt = buildGlobalFixPrompt(scan, findingViews);

    return {
        priorScanDiff,
        topFixes: findingViews.slice(0, 3),
        findingViews,
        globalFixPrompt,
        globalChatHref: buildGlobalChatHref(scan.owner, scan.repo, globalFixPrompt),
    };
}

function isHighPriorityOutreachCandidate(view: ReportFindingView): boolean {
    const severity = view.finding.severity;
    const confidence = view.finding.confidence;
    return (severity === "critical" || severity === "high") && confidence === "high";
}

function inferInterestingAreaFromFinding(view: ReportFindingView | null): string {
    if (!view) {
        return "some of the implementation details";
    }

    const rawPath = view.finding.file.replace(/\\/g, "/");
    const segments = rawPath.split("/").filter(Boolean);
    const interestingSegments = segments.filter((segment) => {
        const normalized = segment.toLowerCase();
        return !["src", "app", "lib", "components", "pages", "api"].includes(normalized)
            && !normalized.endsWith(".ts")
            && !normalized.endsWith(".tsx")
            && !normalized.endsWith(".js")
            && !normalized.endsWith(".jsx");
    });

    if (interestingSegments.length > 0) {
        const focus = interestingSegments.slice(0, 2).join("/");
        return `the ${focus} area`;
    }

    const fileName = segments[segments.length - 1];
    if (fileName) {
        return `the ${fileName} implementation`;
    }

    return "some of the implementation details";
}

export function buildOutreachPack(scan: StoredScan, shareUrl: string): OutreachPackData {
    const reportView = buildReportViewData(scan);
    const strongestFinding =
        reportView.findingViews.find(isHighPriorityOutreachCandidate) ?? reportView.findingViews[0] ?? null;
    const strongestImpact = strongestFinding?.impact ?? "No validated findings were available to include.";
    const repoHook = inferInterestingAreaFromFinding(strongestFinding);
    const repoProfileUrl = buildAbsoluteUrlFromOrigin(shareUrl, buildRepoProfileHref(scan.owner, scan.repo));

    const { critical, high, medium, low, total } = scan.summary;
    const isClean = total === 0;
    const isHighRisk = (critical ?? 0) > 0 || (high ?? 0) > 0;

    let outreachMessage = "";

    if (isClean) {
        outreachMessage = [
            `Hello ${scan.owner} Team,`,
            "",
            `I recently spent some time exploring ${scan.owner}/${scan.repo} and was particularly impressed by ${repoHook}. The implementation is impressively clean and well-structured.`,
            "",
            `I ran a security health check through RepoMind and it returned zero vulnerabilities. It's rare to see a repository this well-hardened, and I wanted to share the clean report with you.`,
            "",
            "RESOURCES",
            "",
            `Repo Profile: ${repoProfileUrl}`,
            `Security Report: ${shareUrl}`,
            "",
            `You might want to add a RepoMind verified badge to your README to show off the codebase quality!`,
            "",
            `Best regards,`,
        ].join("\n");
    } else if (!isHighRisk) {
        outreachMessage = [
            `Hello ${scan.owner} Team,`,
            "",
            `I've been following ${scan.owner}/${scan.repo} and really appreciated ${repoHook}. It's a great example of modern engineering in this area.`,
            "",
            `I ran a quick hygiene scan with RepoMind and noticed ${total} minor areas where the security posture could be polished (${medium} medium / ${low} low). Nothing critical, just a few maintenance improvements to keep things airtight.`,
            "",
            "RESOURCES",
            "",
            `Repo Profile: ${repoProfileUrl}`,
            `Security Report: ${shareUrl}`,
            "",
            `I've prepared a full report with AI-ready patches to help you resolve them in minutes.`,
            "",
            `Keep up the great work!`,
        ].join("\n");
    } else {
        outreachMessage = [
            `Hello ${scan.owner} Team,`,
            "",
            `I'm a big fan of ${scan.owner}/${scan.repo}, specifically how you've handled ${repoHook}.`,
            "",
            `While doing a deep dive, I ran a RepoMind security scan and identified ${total} findings that require your attention (${high} high / ${critical} critical). Sharing this privately first so you can triage safely before any public disclosure.`,
            "",
            strongestFinding
                ? `One finding that stood out was ${strongestFinding.finding.title} in ${strongestFinding.finding.file}.`
                : "A few high-confidence vulnerabilities were detected.",
            "",
            `Impact: ${strongestImpact}`,
            "",
            "RESOURCES",
            "",
            `Repo Profile: ${repoProfileUrl}`,
            `Private Disclosure Report: ${shareUrl}`,
            "",
            `I've mapped out the full impact and generated suggested fixes in the private report link above.`,
            "",
            `Best regards,`,
        ].join("\n");
    }

    return {
        maintainerNote: outreachMessage.split("RESOURCES")[0].trim(),
        strongestFinding,
        impactStatement: strongestImpact,
        shareUrl,
        outreachMessage,
    };
}
