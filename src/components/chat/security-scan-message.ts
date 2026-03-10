import type { SecurityFinding, ScanSummary } from "@/lib/security-scanner";

export const CACHED_SCAN_BANNER =
    "♻️ Cached result: no code changes detected since the last scan for this mode/settings.";

function buildFixPrompt(finding: SecurityFinding): string {
    return [
        "Fix this security vulnerability:",
        "",
        `Issue: ${finding.title}`,
        `Severity: ${finding.severity.toUpperCase()}`,
        `File: ${finding.file}${finding.line ? ` (Line ${finding.line})` : ""}`,
        `Description: ${finding.description}`,
        `Recommendation: ${finding.recommendation}`,
        "",
        `Please analyze the code in ${finding.file} and implement the fix.`,
    ].join("\n");
}

export function buildSecurityScanMessage(input: {
    summary: ScanSummary;
    findings: SecurityFinding[];
    isFromCache: boolean;
    maxFindingsPreview: number;
}): string {
    const { summary, findings, isFromCache, maxFindingsPreview } = input;
    const cachePrefix = isFromCache ? `${CACHED_SCAN_BANNER}\n\n` : "";

    if (summary.total === 0) {
        return `${cachePrefix}✅ **Security scan complete!**

I've comprehensively scanned the **core repository files** and found **no verified security vulnerabilities**.

Your code looks secure! The scan checked for:
- SQL injection vulnerabilities
- Cross-site scripting (XSS)
- Unsafe child_process usage
- Hardcoded secrets
- Weak cryptographic algorithms
- Command injection

Keep up the good security practices! 🔒`;
    }

    let content = `${cachePrefix}⚠️ **Security scan complete!**

I've comprehensively scanned the **core repository files** and found **${summary.total} verified vulnerabilit${summary.total !== 1 ? "ies" : "y"}**.

`;

    if (summary.critical > 0) content += `🔴 **${summary.critical} Critical**\n`;
    if (summary.high > 0) content += `🟠 **${summary.high} High**\n`;
    if (summary.medium > 0) content += `🟡 **${summary.medium} Medium**\n`;
    if (summary.low > 0) content += `🔵 **${summary.low} Low**\n`;

    content += "\nHere are the key findings:\n\n";

    findings.slice(0, maxFindingsPreview).forEach((finding) => {
        content += `### ${finding.title}\n`;
        content += `**Severity**: ${finding.severity.toUpperCase()}\n`;
        content += `**File**: \`${finding.file}\` ${finding.line ? `(Line ${finding.line})` : ""}\n`;
        content += `**Issue**: ${finding.description}\n`;
        content += `**Fix**: ${finding.recommendation}\n\n`;

        content += `\`\`\`fix-prompt\n${buildFixPrompt(finding)}\n\`\`\`\n\n`;
    });

    if (findings.length > maxFindingsPreview) {
        const hiddenCount = findings.length - maxFindingsPreview;
        content += `*...and ${hiddenCount} more issue${hiddenCount !== 1 ? "s" : ""}.*`;
    }

    return content;
}
