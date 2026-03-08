import { getGenAI, DEFAULT_MODEL } from "./ai-client";
import type { FunctionDeclaration } from "@google/generative-ai";
import type { SecurityFinding } from "./security-scanner";

/**
 * Gemini function declarations for security analysis
 */
const securityAnalysisFunctions = [
    {
        name: "report_sql_injection",
        description: "Report a potential SQL injection vulnerability",
        parameters: {
            type: "object" as const,
            properties: {
                file: { type: "string", description: "File path" },
                line: { type: "number", description: "Approximate line number" },
                code_snippet: { type: "string", description: "Vulnerable code snippet" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                explanation: { type: "string", description: "Why this is vulnerable" },
            },
            required: ["file", "code_snippet", "severity", "explanation"],
        },
    },
    {
        name: "report_xss",
        description: "Report a potential XSS (Cross-Site Scripting) vulnerability",
        parameters: {
            type: "object" as const,
            properties: {
                file: { type: "string", description: "File path" },
                line: { type: "number", description: "Approximate line number" },
                code_snippet: { type: "string", description: "Vulnerable code snippet" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                explanation: { type: "string", description: "Why this is vulnerable" },
            },
            required: ["file", "code_snippet", "severity", "explanation"],
        },
    },
    {
        name: "report_auth_issue",
        description: "Report an authentication or authorization vulnerability",
        parameters: {
            type: "object" as const,
            properties: {
                file: { type: "string", description: "File path" },
                line: { type: "number", description: "Approximate line number" },
                code_snippet: { type: "string", description: "Vulnerable code snippet" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                explanation: { type: "string", description: "What's wrong with the auth/authz" },
            },
            required: ["file", "code_snippet", "severity", "explanation"],
        },
    },
    {
        name: "report_injection",
        description: "Report a code injection, command injection, or path traversal vulnerability",
        parameters: {
            type: "object" as const,
            properties: {
                file: { type: "string", description: "File path" },
                line: { type: "number", description: "Approximate line number" },
                code_snippet: { type: "string", description: "Vulnerable code snippet" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                injection_type: { type: "string", enum: ["command", "path_traversal", "code", "ldap"] },
                explanation: { type: "string", description: "How the injection could occur" },
            },
            required: ["file", "code_snippet", "severity", "injection_type", "explanation"],
        },
    },
    {
        name: "report_crypto_issue",
        description: "Report insecure cryptography usage",
        parameters: {
            type: "object" as const,
            properties: {
                file: { type: "string", description: "File path" },
                line: { type: "number", description: "Approximate line number" },
                code_snippet: { type: "string", description: "Problematic code" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                issue_type: { type: "string", enum: ["weak_algorithm", "hardcoded_key", "no_encryption", "insecure_random"] },
                explanation: { type: "string", description: "What's wrong with the crypto" },
            },
            required: ["file", "code_snippet", "severity", "issue_type", "explanation"],
        },
    },
];

type GeminiSecurityCall = {
    name?: string;
    args?: Record<string, unknown>;
};

function getString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function toSeverity(value: unknown): SecurityFinding["severity"] {
    if (value === "critical" || value === "high" || value === "medium" || value === "low" || value === "info") {
        return value;
    }
    return "medium";
}

function getErrorInfo(error: unknown): { message?: string; status?: unknown; statusText?: unknown } {
    if (!error || typeof error !== "object") return {};
    const err = error as { message?: unknown; status?: unknown; statusText?: unknown };
    return {
        message: typeof err.message === "string" ? err.message : undefined,
        status: err.status,
        statusText: err.statusText,
    };
}

function redactPromptSecrets(input: string): string {
    return input
        .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_OPENAI_KEY]")
        .replace(/ghp_[a-zA-Z0-9]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
        .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]")
        .replace(/(password|token|secret)\s*[:=]\s*['"][^'"]+['"]/gi, "$1=[REDACTED]");
}

/**
 * Analyze code files with Gemini AI for security vulnerabilities.
 *
 * The method is intentionally conservative and only returns findings
 * that pass strict local validation.
 */
export async function analyzeCodeWithGemini(
    files: Array<{ path: string; content: string }>,
    repoAllPaths: string[] = [],
    candidatePaths: string[] = []
): Promise<SecurityFinding[]> {
    try {
        const model = getGenAI().getGenerativeModel({
            model: DEFAULT_MODEL,
            tools: [{ functionDeclarations: securityAnalysisFunctions as unknown as FunctionDeclaration[] }],
        });

        const filesContext = files
            .map((file) => {
                const redacted = redactPromptSecrets(file.content);
                return `\n--- FILE: ${file.path} ---\n\`\`\`\n${redacted.slice(0, 3000)} ${
                    redacted.length > 3000 ? "... (truncated)" : ""
                }\n\`\`\``;
            })
            .join("\n");

        const prompt = `
You are a security engineer assisting a deterministic scanner.
Return ONLY high-confidence true positives.

Repository paths (truncated to first 300):
${repoAllPaths.slice(0, 300).join("\n")}

Candidate paths prioritized by deterministic engine:
${candidatePaths.slice(0, 120).join("\n") || "(none)"}

${filesContext}

Rules:
1) Do not report speculative issues.
2) Prefer verified source->sink flows.
3) For command injection, require child_process execution sinks.
4) For SQL injection, require DB query sink + tainted input.
5) For path traversal, require filesystem sink + tainted path input.
6) If uncertain, do not report.
`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const functionCalls = (response.functionCalls?.() || []) as GeminiSecurityCall[];

        const findings: SecurityFinding[] = functionCalls
            .map((call): SecurityFinding | null => {
                const args = call.args ?? {};
                let title = "";
                let cwe = "";
                let recommendation = "";

                switch (call.name) {
                    case "report_sql_injection":
                        title = "SQL Injection Vulnerability";
                        cwe = "CWE-89";
                        recommendation = "Use parameterized queries or prepared statements. Never concatenate user input into SQL.";
                        break;
                    case "report_xss":
                        title = "Cross-Site Scripting (XSS)";
                        cwe = "CWE-79";
                        recommendation = "Sanitize user input and avoid unsafe HTML sinks with untrusted input.";
                        break;
                    case "report_auth_issue":
                        title = "Authentication/Authorization Issue";
                        cwe = "CWE-287";
                        recommendation = "Enforce authn/authz checks at route and action boundaries.";
                        break;
                    case "report_injection": {
                        const type = getString(args.injection_type) || "code";
                        title = `${type} Injection`;
                        cwe = type === "command" ? "CWE-78" : type === "path_traversal" ? "CWE-22" : "CWE-94";
                        recommendation = "Validate and sanitize all user input. Constrain dangerous sinks with allowlists.";
                        break;
                    }
                    case "report_crypto_issue":
                        title = `Cryptography Issue: ${getString(args.issue_type)}`;
                        cwe = "CWE-327";
                        recommendation = "Use modern cryptography and never hardcode keys/secrets in source.";
                        break;
                    default:
                        return null;
                }

                const confidenceScore = call.name === "report_sql_injection" || call.name === "report_injection" ? 0.88 : 0.84;
                return {
                    type: "code",
                    severity: toSeverity(args.severity),
                    title,
                    description: getString(args.explanation),
                    file: getString(args.file),
                    line: getNumber(args.line),
                    recommendation,
                    cwe,
                    confidence: "high",
                    confidenceScore,
                    engine: "ai-assist",
                    ruleId: `ai-${call.name ?? "unknown"}`,
                    evidence: [{ type: "context", message: "AI-assisted finding passed local validator" }],
                };
            })
            .filter((finding): finding is SecurityFinding => finding !== null)
            .filter((finding) => validateFinding(finding, files));

        return findings;
    } catch (error: unknown) {
        const errorInfo = getErrorInfo(error);
        console.error("Gemini security analysis error:", error);
        console.error("Error details:", {
            message: errorInfo.message,
            status: errorInfo.status,
            statusText: errorInfo.statusText,
        });
        return [];
    }
}

export async function generateSecurityPatch(params: {
    filePath: string;
    fileContent: string;
    line?: number;
    description: string;
    recommendation: string;
    snippet?: string;
}): Promise<{ patch: string; explanation: string }> {
    try {
        const model = getGenAI().getGenerativeModel({
            model: DEFAULT_MODEL,
        });

        const contextSnippet = params.snippet || "";
        const lineInfo = params.line ? `Line: ${params.line}` : "Line: unknown";

        const prompt = `
You are a security engineer. Generate a minimal, safe fix for the vulnerability.

File: ${params.filePath}
${lineInfo}

Issue:
${params.description}

Recommendation:
${params.recommendation}

Context snippet:
\`\`\`
${contextSnippet}
\`\`\`

Full file (may be truncated):
\`\`\`
${params.fileContent.slice(0, 8000)}
${params.fileContent.length > 8000 ? "\n... (truncated)" : ""}
\`\`\`

Return ONLY valid JSON with keys:
- "patch": a unified diff with --- a/${params.filePath} and +++ b/${params.filePath}
- "explanation": a short explanation of the fix

Do not include markdown fences.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const jsonPayload = start !== -1 && end > start ? text.slice(start, end + 1) : null;
        if (!jsonPayload) {
            return { patch: text.trim(), explanation: "Model response did not include JSON." };
        }

        const parsed = JSON.parse(jsonPayload) as { patch?: unknown; explanation?: unknown };
        return {
            patch: String(parsed.patch || "").trim(),
            explanation: String(parsed.explanation || "").trim(),
        };
    } catch (error: unknown) {
        console.error("Gemini patch generation error:", error);
        return {
            patch: "",
            explanation: "Failed to generate patch.",
        };
    }
}

/**
 * Validate AI findings to prevent false positives.
 */
function validateFinding(
    finding: SecurityFinding,
    files: Array<{ path: string; content: string }>
): boolean {
    const file = files.find((item) => item.path === finding.file);
    if (!file) return false;

    const description = (finding.description || "").toLowerCase();
    const title = finding.title.toLowerCase();
    const content = file.content;

    const hasDbLib = /(?:require|import).*(?:mysql|postgres|pg|sqlite|sequelize|knex|typeorm|mongodb|mongoose)/i.test(content);
    const hasSqlSink = /(?:query|execute|raw|run)\s*\(/i.test(content);
    const hasChildProcess = /(?:require|import).*['"](?:node:)?child_process['"]/.test(content);
    const hasCommandSink = /(?:exec|execSync|spawn|spawnSync)\s*\(/.test(content);
    const hasPathSink = /(?:readFile|readFileSync|createReadStream|open|readdir)\s*\(/.test(content);
    const hasXssSink = /(?:innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|res\.send\s*\()/i.test(content);
    const hasInputSource = /(?:req\.|params\.|query\.|body\.|headers\.|cookies\.)/i.test(content);

    if (title.includes("sql")) {
        if (!hasDbLib || !hasSqlSink) return false;
        if (!hasInputSource) return false;
        if (/console\.|log\(|print\(/i.test(description)) return false;
        return true;
    }

    if (title.includes("command")) {
        return hasChildProcess && hasCommandSink && hasInputSource;
    }

    if (title.includes("path_traversal") || title.includes("path traversal")) {
        return hasPathSink && hasInputSource;
    }

    if (title.includes("xss") || title.includes("cross-site")) {
        return hasXssSink && hasInputSource;
    }

    if (title.includes("cryptography")) {
        return /(crypto|md5|sha1|random|encrypt|decrypt|cipher)/i.test(content);
    }

    if (title.includes("auth")) {
        return /(route|middleware|handler|auth|authorize|permission|role|token)/i.test(content);
    }

    return description.length > 20;
}
