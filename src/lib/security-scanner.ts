/**
 * Multi-layered security scanning — in-house, no external APIs.
 * Covers: secrets detection, code pattern analysis, config/IaC misconfigs,
 * and dependency vulnerability heuristics.
 */
import { createHash } from "node:crypto";

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";
type SecurityConfidence = "high" | "medium" | "low";

export interface SecurityEvidence {
    type: "source" | "sink" | "sanitizer" | "context";
    message: string;
    line?: number;
    snippet?: string;
}

export interface SecurityTraceStep {
    type: "source" | "sink" | "flow";
    line?: number;
    detail: string;
}

export interface SecurityFinding {
    id?: string;
    fingerprint?: string;
    ruleId?: string;
    engine?: "deterministic-v2" | "regex-v1" | "ai-assist";
    type: "dependency" | "code" | "secret" | "configuration";
    severity: SecuritySeverity;
    title: string;
    description: string;
    file: string;
    line?: number;
    snippet?: string;
    recommendation: string;
    cwe?: string;
    cvss?: number;
    confidence?: SecurityConfidence;
    confidenceScore?: number;
    evidence?: SecurityEvidence[];
    trace?: SecurityTraceStep[];
}

export interface ScanSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    debug?: {
        filesReceived: number;
        codeFilesFiltered: number;
        filesSuccessfullyFetched: number;
        patternFindings: number;
        aiFindings: number;
        afterDedup: number;
        afterConfidenceFilter: number;
    };
}

export interface ScanEngineV2Options {
    profile?: "quick" | "deep";
    confidenceThreshold?: number;
}

export interface ScanEngineV2Result {
    findings: SecurityFinding[];
    analyzerStats: Record<string, number>;
    aiCandidateFiles: string[];
}

const ENGINE_NAME: SecurityFinding["engine"] = "deterministic-v2";
const CODE_EXTENSIONS = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const LOCKFILE_PATHS = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

function scoreToConfidence(score: number): SecurityConfidence {
    if (score >= 0.85) return "high";
    if (score >= 0.65) return "medium";
    return "low";
}

function confidenceToScore(confidence?: SecurityConfidence): number {
    if (confidence === "high") return 0.9;
    if (confidence === "medium") return 0.72;
    if (confidence === "low") return 0.45;
    return 0.7;
}

function slugifyRuleId(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "security-rule";
}

function findingFingerprint(finding: SecurityFinding): string {
    const payload = [
        finding.ruleId ?? slugifyRuleId(`${finding.type}-${finding.title}`),
        finding.file,
        String(finding.line ?? 0),
        finding.title,
        finding.description.slice(0, 200),
    ].join("|");
    return createHash("sha256").update(payload).digest("hex");
}

function withFindingMetadata(
    finding: SecurityFinding,
    defaults: {
        engine?: SecurityFinding["engine"];
        ruleId?: string;
        confidenceScore?: number;
    } = {}
): SecurityFinding {
    const baseRuleId = finding.ruleId ?? defaults.ruleId ?? slugifyRuleId(`${finding.type}-${finding.title}`);
    const score = Math.max(
        0,
        Math.min(1, finding.confidenceScore ?? defaults.confidenceScore ?? confidenceToScore(finding.confidence))
    );
    const confidence = finding.confidence ?? scoreToConfidence(score);
    const enriched: SecurityFinding = {
        ...finding,
        ruleId: baseRuleId,
        engine: finding.engine ?? defaults.engine ?? ENGINE_NAME,
        confidence,
        confidenceScore: score,
    };
    const fingerprint = finding.fingerprint ?? findingFingerprint(enriched);
    return {
        ...enriched,
        fingerprint,
        id: finding.id ?? `${baseRuleId}:${fingerprint.slice(0, 12)}`,
    };
}

function hasCodeExtension(path: string): boolean {
    return CODE_EXTENSIONS.test(path);
}

function looksTaintedIdentifier(name: string): boolean {
    return /^(req|request|params|query|body|input|payload|cmd|command|path|url|user|token|headers?)$/i.test(name);
}

function lineOf(node: { loc?: { start?: { line?: number } } | null }): number | undefined {
    return node.loc?.start?.line;
}

// ─── Secret Detection Patterns ────────────────────────────────────────────────

const SECRET_PATTERNS = [
    // Generic API key patterns
    {
        name: 'API Key',
        regex: /['"](api[_-]?key|apikey)['"]\s*[:=]\s*['"]([a-zA-Z0-9_\-]{20,})['"]/i,
        severity: 'critical' as const,
    },
    {
        name: 'Hardcoded Password',
        regex: /(?:password|passwd|pwd)['"]\s*[:=]\s*['"]([^'"]{8,})['"]/i,
        severity: 'critical' as const,
    },
    // AWS
    {
        name: 'AWS Access Key ID',
        regex: /(AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}/,
        severity: 'critical' as const,
    },
    {
        name: 'AWS Secret Access Key',
        regex: /aws[_\-.]?(secret|access)[_\-.]?key\s*[:=]\s*['"]([a-zA-Z0-9/+=]{40})['"]/i,
        severity: 'critical' as const,
    },
    // GitHub
    {
        name: 'GitHub Personal Access Token',
        regex: /ghp_[a-zA-Z0-9]{36}/,
        severity: 'critical' as const,
    },
    {
        name: 'GitHub OAuth Token',
        regex: /gho_[a-zA-Z0-9]{36}/,
        severity: 'critical' as const,
    },
    {
        name: 'GitHub App Token',
        regex: /(ghu|ghs|ghr)_[a-zA-Z0-9]{36}/,
        severity: 'critical' as const,
    },
    // OpenAI / AI Services
    {
        name: 'OpenAI API Key',
        regex: /sk-[a-zA-Z0-9]{48}/,
        severity: 'critical' as const,
    },
    {
        name: 'Anthropic API Key',
        regex: /sk-ant-[a-zA-Z0-9\-_]{64,}/,
        severity: 'critical' as const,
    },
    {
        name: 'HuggingFace Token',
        regex: /hf_[a-zA-Z0-9]{34}/,
        severity: 'high' as const,
    },
    // Stripe
    {
        name: 'Stripe Secret Key',
        regex: /sk_(live|test)_[a-zA-Z0-9]{24,}/,
        severity: 'critical' as const,
    },
    {
        name: 'Stripe Publishable Key',
        regex: /pk_(live|test)_[a-zA-Z0-9]{24,}/,
        severity: 'medium' as const,
    },
    // Google
    {
        name: 'Google API Key',
        regex: /AIza[0-9A-Za-z\-_]{35}/,
        severity: 'high' as const,
    },
    {
        name: 'Google OAuth Client Secret',
        regex: /GOCSPX-[a-zA-Z0-9\-_]{28}/,
        severity: 'critical' as const,
    },
    // Twilio
    {
        name: 'Twilio Auth Token',
        regex: /twilio[^a-zA-Z0-9]*['"]\s*[:=]\s*['"][0-9a-f]{32}['"]/i,
        severity: 'critical' as const,
    },
    {
        name: 'Twilio Account SID',
        regex: /AC[a-zA-Z0-9]{32}/,
        severity: 'high' as const,
    },
    // Slack & Discord
    {
        name: 'Slack Bot Token',
        regex: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/,
        severity: 'critical' as const,
    },
    {
        name: 'Slack Webhook URL',
        regex: /hooks\.slack\.com\/services\/[a-zA-Z0-9/_]+/,
        severity: 'high' as const,
    },
    {
        name: 'Discord Bot Token',
        regex: /[MN][a-zA-Z0-9]{23}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27}/,
        severity: 'critical' as const,
    },
    // SendGrid / Mailchimp
    {
        name: 'SendGrid API Key',
        regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/,
        severity: 'critical' as const,
    },
    {
        name: 'Mailchimp API Key',
        regex: /[a-f0-9]{32}-us[0-9]{1,2}/,
        severity: 'high' as const,
    },
    // Firebase
    {
        name: 'Firebase Auth Token',
        regex: /firebase[^a-zA-Z0-9]*token[^a-zA-Z0-9]*['"][a-zA-Z0-9\-_.~+/]{100,}['"]/i,
        severity: 'critical' as const,
    },
    // Azure
    {
        name: 'Azure Storage Account Key',
        regex: /AccountKey=[a-zA-Z0-9+/]{86}==/,
        severity: 'critical' as const,
    },
    // npm / Vercel
    {
        name: 'npm Auth Token',
        regex: /\/\/registry\.npmjs\.org\/:_authToken=[a-zA-Z0-9\-._~+/]+=*/,
        severity: 'high' as const,
    },
    {
        name: 'Vercel Token',
        regex: /vercel[^a-zA-Z0-9]*token\s*[:=]\s*['"](.*?)['"]/i,
        severity: 'high' as const,
    },
    // Private Keys / Certs
    {
        name: 'Private Key',
        regex: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP|ENCRYPTED) PRIVATE KEY-----/,
        severity: 'critical' as const,
    },
    // JWT
    {
        name: 'JWT Token',
        regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
        severity: 'high' as const,
    },
    // Generic high-entropy secrets in key/token/secret assignments
    {
        name: 'Hardcoded Secret',
        regex: /(?:secret|auth_token|access_token|refresh_token|client_secret)\s*[:=]\s*['"]([a-zA-Z0-9+/=_\-]{32,})['"]/i,
        severity: 'high' as const,
    },
    // Database connection strings with credentials
    {
        name: 'Database Connection String with Credentials',
        regex: /(?:postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@]+@/i,
        severity: 'critical' as const,
    },
];

export function detectSecrets(filepath: string, content: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    if (typeof content !== 'string') return findings;

    // Ignore lockfiles as they contain hashes that frequently trigger false positives
    const isLockfile = /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|Gemfile\.lock$|poetry\.lock$|composer\.lock$/i.test(filepath);
    if (isLockfile) return findings;

    const lines = content.split('\n');
    lines.forEach((line, index) => {
        // Skip obvious comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;

        SECRET_PATTERNS.forEach(pattern => {
            if (pattern.regex.test(line)) {
                // Avoid flagging placeholder values like "your-api-key-here"
                if (/your[-_]?|<.*?>|example|placeholder|xxx|fake|dummy|changeme/i.test(line)) return;
                findings.push({
                    type: 'secret',
                    severity: pattern.severity,
                    title: `Exposed ${pattern.name}`,
                    description: `Found hardcoded ${pattern.name} in source code at line ${index + 1}`,
                    file: filepath,
                    line: index + 1,
                    recommendation: 'Move to environment variables or a secrets management system. Rotate the exposed credential immediately.',
                    cwe: 'CWE-798',
                    confidence: 'high',
                });
            }
        });
    });

    return findings;
}

// ─── Code Pattern Detection ───────────────────────────────────────────────────

interface CodePattern {
    name: string;
    regex: RegExp;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    cwe: string;
    recommendation: string;
    validate?: (fileContent: string, matchedLine: string) => boolean;
}

const CODE_PATTERNS: CodePattern[] = [
    // Execution sinks
    {
        name: 'Unsafe eval() usage',
        regex: /\beval\s*\(/,
        severity: 'high',
        cwe: 'CWE-95',
        recommendation: 'Avoid eval(). Use JSON.parse(), Map lookups, or safe alternatives.',
    },
    {
        name: 'Dynamic Function constructor',
        regex: /new\s+Function\s*\(/,
        severity: 'high',
        cwe: 'CWE-95',
        recommendation: 'new Function() can execute arbitrary code. Avoid dynamic code execution.',
    },
    // DOM/XSS
    {
        name: 'Unsafe innerHTML assignment',
        regex: /\.innerHTML\s*=/,
        severity: 'medium',
        cwe: 'CWE-79',
        recommendation: 'Use textContent or a sanitization library (DOMPurify) before setting innerHTML.',
    },
    {
        name: 'Unsafe dangerouslySetInnerHTML',
        regex: /dangerouslySetInnerHTML\s*=\s*\{\s*\{?\s*__html\s*:/,
        severity: 'medium',
        cwe: 'CWE-79',
        recommendation: 'Sanitize HTML with DOMPurify before passing to dangerouslySetInnerHTML.',
    },
    {
        name: 'document.write usage',
        regex: /document\.write\s*\(/,
        severity: 'medium',
        cwe: 'CWE-79',
        recommendation: 'Avoid document.write(). Use DOM manipulation or innerHTML with sanitization.',
    },
    // Injection
    {
        name: 'SQL string concatenation',
        regex: /(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\s+.*?\+\s*(?:req\.|params\.|query\.|body\.|user\.|input\.|this\.)/i,
        severity: 'high',
        cwe: 'CWE-89',
        recommendation: 'Use parameterized queries or an ORM to prevent SQL injection.',
        validate: (content) =>
            /(?:require|import).*(?:mysql|postgres|pg|sqlite|sequelize|knex|typeorm|mongodb|mongoose)/i.test(content),
    },
    {
        name: 'Unsafe child_process.exec',
        regex: /(?:child_process|cp)\s*\.\s*(?:exec|execSync)\s*\(/,
        severity: 'high',
        cwe: 'CWE-78',
        recommendation: 'Use execFile() or spawn() instead, and validate/sanitize all inputs.',
        validate: (content) => /(?:require|import).*['"]child_process['"]/.test(content),
    },
    {
        name: 'Shell injection via shell: true',
        regex: /spawn\s*\(.*shell\s*:\s*true/,
        severity: 'high',
        cwe: 'CWE-78',
        recommendation: 'Avoid shell:true in spawn. Use execFile() with a fixed command and validated arguments.',
    },
    // Open redirect
    {
        name: 'Potential open redirect',
        regex: /res\.redirect\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
        severity: 'medium',
        cwe: 'CWE-601',
        recommendation: 'Validate redirect URLs against an allowlist. Never redirect to arbitrary user-controlled URLs.',
    },
    // SSRF
    {
        name: 'Potential SSRF (fetch with user input)',
        regex: /(?:fetch|axios\.get|axios\.post|axios\.request|http\.get|https\.get)\s*\(\s*(?:req\.|params\.|query\.|body\.|user\.)/,
        severity: 'high',
        cwe: 'CWE-918',
        recommendation: 'Validate and allowlist URLs before making server-side HTTP requests.',
    },
    // Path traversal
    {
        name: 'Potential path traversal',
        regex: /(?:fs\.readFile|fs\.readFileSync|path\.join|path\.resolve)\s*\([^)]*(?:req\.|params\.|query\.|body\.)/,
        severity: 'high',
        cwe: 'CWE-22',
        recommendation: 'Validate and sanitize file paths. Use path.resolve() and check the result is within expected directory.',
    },
    // Prototype pollution
    {
        name: 'Prototype pollution vector',
        regex: /\[?\s*['"]__proto__['"]\s*\]?\s*=|\[?\s*['"]constructor['"]\s*\]?\s*\.\s*['"]prototype['"]/,
        severity: 'high',
        cwe: 'CWE-1321',
        recommendation: 'Avoid setting __proto__ or mutating Object.prototype. Use Object.create(null) for safe maps.',
    },
    // Crypto
    {
        name: 'Weak hash algorithm (MD5/SHA1)',
        regex: /\b(?:md5|sha1|sha-1)\b/i,
        severity: 'medium',
        cwe: 'CWE-327',
        recommendation: 'Use SHA-256 or stronger. MD5 and SHA-1 are cryptographically broken.',
    },
    {
        name: 'Insecure random number generation',
        regex: /Math\.random\s*\(\s*\)/,
        severity: 'low',
        cwe: 'CWE-338',
        recommendation: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive randomness.',
    },
    // ReDoS
    {
        name: 'Potential ReDoS vulnerable regex',
        regex: /new RegExp\(.*\+.*\)|\/\(\.\+\)\+\/|\/\(a\+\)\+\/|\/\(.*\|\.\*\)\+\//,
        severity: 'medium',
        cwe: 'CWE-1333',
        recommendation: 'Audit regex for catastrophic backtracking. Use a ReDoS checker and set input length limits.',
    },
    // Cookie security
    {
        name: 'Cookie without HttpOnly flag',
        regex: /(?:res\.cookie|Set-Cookie)[^;)]*(?!httponly|HttpOnly)/i,
        severity: 'low',
        cwe: 'CWE-1004',
        recommendation: 'Set HttpOnly flag on cookies to prevent XSS-based cookie theft.',
    },
    // Insecure deserialization
    {
        name: 'Unsafe deserialization (serialize-javascript)',
        regex: /require\(['"]serialize-javascript['"]\)|unserialize\s*\(/,
        severity: 'high',
        cwe: 'CWE-502',
        recommendation: 'Avoid deserializing untrusted data. Validate and schema-check all external inputs.',
    },
    // Timing attacks
    {
        name: 'Non-constant-time string comparison for secrets',
        regex: /(?:===|!==|==|!=)\s*(?:token|password|secret|hash|hmac|signature)/i,
        severity: 'low',
        cwe: 'CWE-208',
        recommendation: 'Use crypto.timingSafeEqual() for comparing secrets to prevent timing attacks.',
    },
    // Missing auth check heuristic
    {
        name: 'Route handler without apparent auth check',
        regex: /(?:app|router)\.(?:get|post|put|delete|patch)\s*\([^)]+,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{(?:(?!(?:auth|jwt|session|token|middleware))[\s\S])*\}/,
        severity: 'info',
        cwe: 'CWE-306',
        recommendation: 'Verify that this route has proper authentication/authorization middleware applied.',
    },
];

function isTaintedExpression(node: t.Node | null | undefined, tainted: Set<string>): boolean {
    if (!node) return false;
    if (t.isIdentifier(node)) {
        return tainted.has(node.name) || looksTaintedIdentifier(node.name);
    }
    if (t.isMemberExpression(node)) {
        if (t.isIdentifier(node.object) && looksTaintedIdentifier(node.object.name)) {
            return true;
        }
        if (t.isIdentifier(node.object) && tainted.has(node.object.name)) {
            return true;
        }
        return isTaintedExpression(node.object, tainted) || isTaintedExpression(node.property, tainted);
    }
    if (t.isTemplateLiteral(node)) {
        return node.expressions.some((expr) => isTaintedExpression(expr, tainted));
    }
    if (t.isBinaryExpression(node)) {
        return isTaintedExpression(node.left, tainted) || isTaintedExpression(node.right, tainted);
    }
    if (t.isCallExpression(node)) {
        return node.arguments.some((arg) => (t.isExpression(arg) ? isTaintedExpression(arg, tainted) : false));
    }
    return false;
}

function isDynamicQueryExpression(node: t.Node | null | undefined): boolean {
    if (!node) return false;
    return t.isTemplateLiteral(node) || t.isBinaryExpression(node);
}

function createAstFinding(params: {
    filepath: string;
    title: string;
    description: string;
    recommendation: string;
    cwe: string;
    severity: SecuritySeverity;
    line?: number;
    ruleId: string;
    confidenceScore: number;
    evidence: SecurityEvidence[];
}): SecurityFinding {
    return withFindingMetadata(
        {
            type: "code",
            title: params.title,
            description: params.description,
            recommendation: params.recommendation,
            cwe: params.cwe,
            severity: params.severity,
            file: params.filepath,
            line: params.line,
            evidence: params.evidence,
            engine: "deterministic-v2",
        },
        {
            ruleId: params.ruleId,
            confidenceScore: params.confidenceScore,
            engine: "deterministic-v2",
        }
    );
}

export function detectCodePatternsAst(filepath: string, content: string): SecurityFinding[] {
    if (!hasCodeExtension(filepath) || typeof content !== "string" || content.length > 250_000) {
        return [];
    }

    let ast: t.File;
    try {
        ast = parse(content, {
            sourceType: "unambiguous",
            plugins: [
                "typescript",
                "jsx",
                "classProperties",
                "decorators-legacy",
                "dynamicImport",
            ],
            errorRecovery: true,
        });
    } catch {
        return [];
    }

    const findings: SecurityFinding[] = [];
    const tainted = new Set<string>();
    let hasDbLibrary = false;
    const childProcessAliases = new Set<string>();
    const childProcessFns = new Set<string>();

    const addFinding = (finding: SecurityFinding) => {
        findings.push(finding);
    };

    traverse(ast, {
        ImportDeclaration(path) {
            const source = path.node.source.value;
            if (/(mysql|postgres|pg|sqlite|sequelize|knex|typeorm|mongodb|mongoose)/i.test(source)) {
                hasDbLibrary = true;
            }
            if (source === "child_process" || source === "node:child_process") {
                for (const spec of path.node.specifiers) {
                    if (t.isImportNamespaceSpecifier(spec) || t.isImportDefaultSpecifier(spec)) {
                        childProcessAliases.add(spec.local.name);
                    }
                    if (t.isImportSpecifier(spec)) {
                        childProcessFns.add(spec.local.name);
                    }
                }
            }
        },
        VariableDeclarator(path) {
            if (t.isIdentifier(path.node.id) && isTaintedExpression(path.node.init, tainted)) {
                tainted.add(path.node.id.name);
            }
            if (
                t.isIdentifier(path.node.id) &&
                t.isCallExpression(path.node.init) &&
                t.isIdentifier(path.node.init.callee) &&
                path.node.init.callee.name === "require" &&
                path.node.init.arguments.length > 0 &&
                t.isStringLiteral(path.node.init.arguments[0]) &&
                (path.node.init.arguments[0].value === "child_process" ||
                    path.node.init.arguments[0].value === "node:child_process")
            ) {
                childProcessAliases.add(path.node.id.name);
            }
        },
        AssignmentExpression(path) {
            if (t.isIdentifier(path.node.left) && isTaintedExpression(path.node.right, tainted)) {
                tainted.add(path.node.left.name);
            }
            if (
                t.isMemberExpression(path.node.left) &&
                t.isIdentifier(path.node.left.property) &&
                path.node.left.property.name === "innerHTML" &&
                isTaintedExpression(path.node.right, tainted)
            ) {
                addFinding(
                    createAstFinding({
                        filepath,
                        title: "Tainted data assigned to innerHTML",
                        description: "Potential XSS path detected: tainted user input reaches innerHTML.",
                        recommendation: "Sanitize or encode user input before writing to innerHTML.",
                        cwe: "CWE-79",
                        severity: "high",
                        line: lineOf(path.node),
                        ruleId: "xss-innerhtml-taint",
                        confidenceScore: 0.9,
                        evidence: [{ type: "sink", message: "innerHTML assignment with tainted expression", line: lineOf(path.node) }],
                    })
                );
            }
        },
        Function(path) {
            for (const param of path.node.params) {
                if (t.isIdentifier(param) && looksTaintedIdentifier(param.name)) {
                    tainted.add(param.name);
                }
            }
        },
        CallExpression(path) {
            const callee = path.node.callee;
            const args = path.node.arguments;

            const firstArg = args[0];
            const firstArgExpr = t.isExpression(firstArg) ? firstArg : null;
            const line = lineOf(path.node);

            // SQL injection with tainted dynamic query
            const isSqlCall =
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.property) &&
                /^(query|execute|raw|run)$/i.test(callee.property.name);
            if (
                isSqlCall &&
                hasDbLibrary &&
                firstArgExpr &&
                isTaintedExpression(firstArgExpr, tainted) &&
                isDynamicQueryExpression(firstArgExpr)
            ) {
                addFinding(
                    createAstFinding({
                        filepath,
                        title: "SQL injection via tainted query construction",
                        description: "Tainted input appears in dynamically constructed SQL query.",
                        recommendation: "Use parameterized queries/prepared statements and never interpolate user input into SQL.",
                        cwe: "CWE-89",
                        severity: "high",
                        line,
                        ruleId: "sqli-tainted-dynamic-query",
                        confidenceScore: 0.92,
                        evidence: [{ type: "sink", message: "Database query sink receives tainted dynamic expression", line }],
                    })
                );
            }

            // Command injection through child_process sinks
            const isChildProcessCall =
                (t.isIdentifier(callee) &&
                    (childProcessFns.has(callee.name) || /^(exec|execSync|spawn|spawnSync)$/i.test(callee.name))) ||
                (t.isMemberExpression(callee) &&
                    t.isIdentifier(callee.object) &&
                    t.isIdentifier(callee.property) &&
                    childProcessAliases.has(callee.object.name) &&
                    /^(exec|execSync|spawn|spawnSync)$/i.test(callee.property.name));

            if (isChildProcessCall && firstArgExpr && isTaintedExpression(firstArgExpr, tainted)) {
                addFinding(
                    createAstFinding({
                        filepath,
                        title: "Command injection via tainted process invocation",
                        description: "Tainted user input appears to reach a child_process execution sink.",
                        recommendation: "Avoid shell execution for user input. Use allowlisted arguments with execFile/spawn and strict validation.",
                        cwe: "CWE-78",
                        severity: "high",
                        line,
                        ruleId: "command-injection-taint",
                        confidenceScore: 0.91,
                        evidence: [{ type: "sink", message: "child_process sink receives tainted input", line }],
                    })
                );
            }

            // Path traversal heuristics using tainted path
            const isPathSink =
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.property) &&
                /^(readFile|readFileSync|open|createReadStream|readdir|readdirSync|stat|statSync)$/i.test(
                    callee.property.name
                );
            if (isPathSink && firstArgExpr && isTaintedExpression(firstArgExpr, tainted)) {
                addFinding(
                    createAstFinding({
                        filepath,
                        title: "Path traversal via tainted filesystem path",
                        description: "Untrusted input appears to control filesystem path access.",
                        recommendation: "Normalize and validate paths against an allowlisted root before filesystem access.",
                        cwe: "CWE-22",
                        severity: "high",
                        line,
                        ruleId: "path-traversal-taint",
                        confidenceScore: 0.88,
                        evidence: [{ type: "sink", message: "Filesystem sink receives tainted path input", line }],
                    })
                );
            }
        },
    });

    return findings;
}

export function detectCodePatterns(filepath: string, content: string): SecurityFinding[] {
    if (!/\.(js|jsx|ts|tsx|py|java|php|rb|go|rs)$/i.test(filepath)) return [];
    if (typeof content !== "string") return [];

    const astFindings = detectCodePatternsAst(filepath, content);
    const regexFindings: SecurityFinding[] = [];
    const lines = content.split("\n");

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("#")) {
            return;
        }
        CODE_PATTERNS.forEach((pattern) => {
            if (!pattern.regex.test(line)) return;
            if (pattern.validate && !pattern.validate(content, line)) return;
            regexFindings.push(
                withFindingMetadata(
                    {
                        type: "code",
                        severity: pattern.severity,
                        title: pattern.name,
                        description: `Potentially unsafe code pattern at line ${index + 1}`,
                        file: filepath,
                        line: index + 1,
                        recommendation: pattern.recommendation,
                        cwe: pattern.cwe,
                        confidence: pattern.validate ? "high" : "medium",
                        engine: "regex-v1",
                    },
                    {
                        ruleId: slugifyRuleId(`regex-${pattern.name}`),
                        confidenceScore: pattern.validate ? 0.83 : 0.68,
                        engine: "regex-v1",
                    }
                )
            );
        });
    });

    return [...astFindings, ...regexFindings];
}

// ─── Configuration / IaC Misconfiguration Detection ──────────────────────────

export function detectConfigIssues(filepath: string, content: string): SecurityFinding[] {
    if (typeof content !== 'string') return [];
    const isConfigFile =
        /\.(ya?ml|toml|json|env|ini|config|cfg)$/i.test(filepath) ||
        /\.env\./i.test(filepath) ||
        filepath.endsWith('.env');
    if (!isConfigFile) return [];

    const findings: SecurityFinding[] = [];
    const lines = content.split('\n');
    const fullContent = content;

    // 1. Reject TLS validation
    if (/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/i.test(fullContent)) {
        findings.push({
            type: 'configuration',
            severity: 'high',
            title: 'TLS Validation Disabled',
            description: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables SSL certificate verification entirely.',
            file: filepath,
            recommendation: 'Remove this setting. Use proper CA certificates or set NODE_EXTRA_CA_CERTS instead.',
            cwe: 'CWE-295',
            confidence: 'high',
        });
    }

    // 2. Insecure HTTP endpoint in production-looking config
    if (/(?:API_URL|BASE_URL|BACKEND_URL|SERVICE_URL)\s*=\s*http:\/\//i.test(fullContent)) {
        findings.push({
            type: 'configuration',
            severity: 'medium',
            title: 'Insecure HTTP Endpoint in Config',
            description: 'A service URL is configured with HTTP instead of HTTPS, exposing traffic to interception.',
            file: filepath,
            recommendation: 'Use HTTPS for all production service URLs.',
            cwe: 'CWE-319',
            confidence: 'high',
        });
    }

    // 3. Permissive CORS
    if (/Access-Control-Allow-Origin\s*[:=]\s*['"]\*['"]/i.test(fullContent)) {
        findings.push({
            type: 'configuration',
            severity: 'medium',
            title: 'Permissive CORS Policy',
            description: 'Access-Control-Allow-Origin is set to *, allowing any origin to access this resource.',
            file: filepath,
            recommendation: 'Restrict CORS to specific trusted origins.',
            cwe: 'CWE-942',
            confidence: 'high',
        });
    }

    // 4. Debug mode enabled
    if (/(?:DEBUG|APP_DEBUG|DEBUG_MODE)\s*=\s*(?:true|1|yes|on|"|')/i.test(fullContent)) {
        findings.push({
            type: 'configuration',
            severity: 'medium',
            title: 'Debug Mode Enabled',
            description: 'Debug mode is enabled, which may expose stack traces, internal paths, and sensitive data.',
            file: filepath,
            recommendation: 'Disable debug mode in production configurations.',
            cwe: 'CWE-215',
            confidence: 'medium',
        });
    }

    // 5. Real secrets in .env.example
    if (filepath.includes('.env.example') || filepath.includes('.env.sample')) {
        SECRET_PATTERNS.forEach(pattern => {
            if (pattern.regex.test(fullContent) && !/your[-_]?|<.*?>|example|placeholder|xxx|fake|dummy|changeme/i.test(fullContent)) {
                findings.push({
                    type: 'configuration',
                    severity: 'high',
                    title: `Possible Real Secret in Example Env File`,
                    description: `${filepath} may contain a real ${pattern.name} instead of a placeholder.`,
                    file: filepath,
                    recommendation: 'Replace real credentials with placeholder values in example env files.',
                    cwe: 'CWE-798',
                    confidence: 'medium',
                });
            }
        });
    }

    // 6. Hardcoded secrets in YAML/TOML (key: value format with long string values)
    lines.forEach((line, index) => {
        if (/^\s*#/.test(line)) return;
        if (/(?:password|secret|token|key|credential)\s*:\s*['"]?([a-zA-Z0-9+/=_\-]{16,})['"]?/i.test(line)) {
            const valueMatch = line.match(/:\s*['"]?([a-zA-Z0-9+/=_\-]{16,})['"]?/);
            const value = valueMatch?.[1] ?? '';
            if (!/your[-_]?|example|placeholder|changeme|xxx|fake|dummy/i.test(value)) {
                findings.push({
                    type: 'configuration',
                    severity: 'high',
                    title: 'Hardcoded Secret in Config File',
                    description: `Line ${index + 1} appears to contain a hardcoded credential or secret.`,
                    file: filepath,
                    line: index + 1,
                    recommendation: 'Use environment variable references (e.g. ${MY_SECRET}) instead of hardcoded values.',
                    cwe: 'CWE-798',
                    confidence: 'medium',
                });
            }
        }
    });

    return findings;
}

// ─── Dependency Vulnerability Heuristics ─────────────────────────────────────

interface DependencyVulnerabilityRule {
    range: string;
    severity: SecuritySeverity;
    issue: string;
    cve?: string;
}

const KNOWN_VULNERABLE: Record<string, DependencyVulnerabilityRule[]> = {
    lodash: [{ range: "<4.17.21", severity: "high", issue: "Prototype pollution vulnerability", cve: "CVE-2019-10744" }],
    "node-fetch": [{ range: "<2.6.7", severity: "high", issue: "Potential SSRF vulnerability in older versions", cve: "CVE-2022-0235" }],
    axios: [{ range: "<1.6.0", severity: "medium", issue: "Potential CSRF vulnerability in older versions", cve: "CVE-2023-45857" }],
    jsonwebtoken: [{ range: "<9.0.0", severity: "high", issue: "Algorithm confusion risk in older versions", cve: "CVE-2022-23529" }],
    express: [{ range: "<4.19.2", severity: "medium", issue: "Open redirect/XSS risks in older versions", cve: "CVE-2024-29041" }],
    ws: [{ range: "<7.4.6", severity: "high", issue: "Potential ReDoS vulnerability in older versions", cve: "CVE-2021-32640" }],
    "serialize-javascript": [{ range: "<3.1.0", severity: "high", issue: "Potential remote code execution risk", cve: "CVE-2020-7660" }],
    ejs: [{ range: "<3.1.7", severity: "high", issue: "Template injection risk in older versions", cve: "CVE-2022-29078" }],
    tar: [{ range: "<6.1.9", severity: "high", issue: "Path traversal vulnerability in older versions", cve: "CVE-2021-37713" }],
    semver: [{ range: "<7.5.2", severity: "medium", issue: "Potential ReDoS vulnerability in older versions", cve: "CVE-2022-25883" }],
    "tough-cookie": [{ range: "<4.1.3", severity: "medium", issue: "Prototype pollution vulnerability in older versions", cve: "CVE-2023-26136" }],
    xml2js: [{ range: "<0.5.0", severity: "medium", issue: "Prototype pollution vulnerability in older versions", cve: "CVE-2023-0842" }],
    minimist: [{ range: "<1.2.6", severity: "high", issue: "Prototype pollution vulnerability in older versions", cve: "CVE-2021-44906" }],
};

function downgradeDevSeverity(severity: SecuritySeverity): SecuritySeverity {
    if (severity === "critical") return "high";
    if (severity === "high") return "medium";
    if (severity === "medium") return "low";
    return severity;
}

function toVersionTuple(input: string): [number, number, number] | null {
    const normalized = input.trim().replace(/^[~^<>=\sv]+/, "").split("-")[0];
    const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(a: string, b: string): number {
    const left = toVersionTuple(a);
    const right = toVersionTuple(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 3; i += 1) {
        if (left[i] < right[i]) return -1;
        if (left[i] > right[i]) return 1;
    }
    return 0;
}

function matchesComparator(version: string, comparator: string): boolean {
    const trimmed = comparator.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith("<=")) return compareVersions(version, trimmed.slice(2).trim()) <= 0;
    if (trimmed.startsWith(">=")) return compareVersions(version, trimmed.slice(2).trim()) >= 0;
    if (trimmed.startsWith("<")) return compareVersions(version, trimmed.slice(1).trim()) < 0;
    if (trimmed.startsWith(">")) return compareVersions(version, trimmed.slice(1).trim()) > 0;
    if (trimmed.startsWith("=")) return compareVersions(version, trimmed.slice(1).trim()) === 0;
    return compareVersions(version, trimmed) === 0;
}

function isVersionInRange(version: string, range: string): boolean {
    const parts = range
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.every((part) => matchesComparator(version, part));
}

function parseDeclaredPinnedVersion(input: string): string | undefined {
    const match = input.match(/^\s*(\d+\.\d+\.\d+)/);
    return match?.[1];
}

function dependencyNameFromSpecifier(specifier: string): string {
    const trimmed = specifier.trim().replace(/^['"]|['"]$/g, "");
    const scoped = trimmed.match(/^(@[^/]+\/[^@]+)@/);
    if (scoped) return scoped[1];
    const plain = trimmed.match(/^([^@]+)@/);
    return plain?.[1] ?? trimmed;
}

function parsePackageLockVersions(content: string): Map<string, string> {
    const map = new Map<string, string>();
    try {
        const lock = JSON.parse(content) as {
            packages?: Record<string, { version?: string }>;
            dependencies?: Record<string, { version?: string; dependencies?: Record<string, unknown> }>;
        };
        if (lock.packages) {
            for (const [key, value] of Object.entries(lock.packages)) {
                if (!value?.version) continue;
                const dep = key.startsWith("node_modules/") ? key.replace(/^node_modules\//, "") : key;
                if (!dep || dep === ".") continue;
                map.set(dep, value.version);
            }
        }
        if (lock.dependencies) {
            const visit = (deps: Record<string, { version?: string; dependencies?: Record<string, unknown> }>) => {
                for (const [dep, meta] of Object.entries(deps)) {
                    if (meta?.version && !map.has(dep)) {
                        map.set(dep, meta.version);
                    }
                    if (meta?.dependencies) {
                        visit(meta.dependencies as Record<string, { version?: string; dependencies?: Record<string, unknown> }>);
                    }
                }
            };
            visit(lock.dependencies);
        }
    } catch {
        return map;
    }
    return map;
}

function parseYarnLockVersions(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = content.split("\n");
    let currentDeps: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (!rawLine.startsWith(" ") && line.endsWith(":")) {
            const specifiers = line
                .slice(0, -1)
                .split(",")
                .map((part) => dependencyNameFromSpecifier(part));
            currentDeps = specifiers;
            continue;
        }

        if (line.startsWith("version ") && currentDeps.length > 0) {
            const match = line.match(/^version\s+"([^"]+)"/);
            const version = match?.[1];
            if (version) {
                currentDeps.forEach((dep) => {
                    if (!map.has(dep)) map.set(dep, version);
                });
            }
        }
    }
    return map;
}

function parsePnpmLockVersions(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = content.split("\n");
    for (const rawLine of lines) {
        const line = rawLine.trim();
        const match = line.match(/^\/?(@?[^@/\s]+(?:\/[^@/\s]+)?)@([^:]+):$/);
        if (!match) continue;
        const dep = match[1];
        const version = match[2].split("(")[0];
        if (!map.has(dep)) {
            map.set(dep, version);
        }
    }
    return map;
}

function buildResolvedDependencyIndex(lockfiles: { packageLock?: string; yarnLock?: string; pnpmLock?: string }): Map<string, string> {
    const map = new Map<string, string>();
    const fromPackageLock = lockfiles.packageLock ? parsePackageLockVersions(lockfiles.packageLock) : new Map<string, string>();
    const fromYarn = lockfiles.yarnLock ? parseYarnLockVersions(lockfiles.yarnLock) : new Map<string, string>();
    const fromPnpm = lockfiles.pnpmLock ? parsePnpmLockVersions(lockfiles.pnpmLock) : new Map<string, string>();
    for (const source of [fromPackageLock, fromYarn, fromPnpm]) {
        for (const [dep, version] of source.entries()) {
            if (!map.has(dep)) map.set(dep, version);
        }
    }
    return map;
}

export function analyzeDependencies(
    packageJsonContent: string,
    lockfiles: { packageLock?: string; yarnLock?: string; pnpmLock?: string } = {}
): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    try {
        const pkg = JSON.parse(packageJsonContent) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const runtimeDeps = Object.entries(pkg.dependencies ?? {}).map(([name, declared]) => ({
            name,
            declared,
            isDev: false,
        }));
        const devDeps = Object.entries(pkg.devDependencies ?? {}).map(([name, declared]) => ({
            name,
            declared,
            isDev: true,
        }));
        const resolvedIndex = buildResolvedDependencyIndex(lockfiles);

        for (const dep of [...runtimeDeps, ...devDeps]) {
            const rules = KNOWN_VULNERABLE[dep.name];
            if (!rules?.length) continue;

            const resolved = resolvedIndex.get(dep.name) ?? parseDeclaredPinnedVersion(dep.declared);
            if (!resolved) continue;

            for (const rule of rules) {
                if (!isVersionInRange(resolved, rule.range)) continue;
                const severity = dep.isDev ? downgradeDevSeverity(rule.severity) : rule.severity;
                findings.push(
                    withFindingMetadata(
                        {
                            type: "dependency",
                            severity,
                            title: `Vulnerable dependency version: ${dep.name}@${resolved}`,
                            description: `${rule.issue}. Affected range: ${rule.range}.`,
                            file: "package.json",
                            recommendation: `Upgrade \`${dep.name}\` to a non-vulnerable version. ${rule.cve ? `See ${rule.cve}.` : ""}`,
                            cwe: "CWE-1035",
                            confidence: "high",
                            evidence: [
                                {
                                    type: "context",
                                    message: `Declared: ${dep.declared}, resolved: ${resolved}, scope: ${dep.isDev ? "dev" : "runtime"}`,
                                },
                            ],
                        },
                        {
                            ruleId: `dep-${dep.name}-${rule.cve?.toLowerCase() ?? "advisory"}`,
                            confidenceScore: dep.isDev ? 0.76 : 0.9,
                            engine: ENGINE_NAME,
                        }
                    )
                );
            }
        }
    } catch {
        return findings;
    }
    return findings;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function groupBySeverity(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
    return findings.reduce((acc, finding) => {
        if (!acc[finding.severity]) acc[finding.severity] = [];
        acc[finding.severity].push(finding);
        return acc;
    }, {} as Record<string, SecurityFinding[]>);
}

export function getScanSummary(findings: SecurityFinding[]): ScanSummary {
    const counts = findings.reduce(
        (acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; },
        {} as Record<string, number>
    );
    return {
        total: findings.length,
        critical: counts.critical ?? 0,
        high: counts.high ?? 0,
        medium: counts.medium ?? 0,
        low: counts.low ?? 0,
        info: counts.info ?? 0,
    };
}

/** Main scanning function — runs all detectors across the given files */
export function scanFiles(files: Array<{ path: string; content: string }>): SecurityFinding[] {
    return runScanEngineV2(files, { profile: "deep", confidenceThreshold: 0 }).findings;
}

function dedupeFindings(findings: SecurityFinding[]): SecurityFinding[] {
    const seen = new Set<string>();
    const out: SecurityFinding[] = [];
    for (const raw of findings) {
        const finding = withFindingMetadata(raw, { engine: raw.engine ?? ENGINE_NAME });
        if (!finding.fingerprint) continue;
        if (seen.has(finding.fingerprint)) continue;
        seen.add(finding.fingerprint);
        out.push(finding);
    }
    return out;
}

export function runScanEngineV2(
    files: Array<{ path: string; content: string }>,
    options: ScanEngineV2Options = {}
): ScanEngineV2Result {
    const profile = options.profile ?? "quick";
    const confidenceThreshold = options.confidenceThreshold ?? (profile === "deep" ? 0.68 : 0.78);
    const findings: SecurityFinding[] = [];

    const fileMap = new Map(files.map((file) => [file.path, file.content]));
    const analyzerStats: Record<string, number> = {
        filesReceived: files.length,
        secretFindings: 0,
        codeFindings: 0,
        configFindings: 0,
        dependencyFindings: 0,
    };

    for (const file of files) {
        if (!LOCKFILE_PATHS.has(file.path)) {
            const secretFindings = detectSecrets(file.path, file.content).map((finding) =>
                withFindingMetadata(finding, {
                    ruleId: slugifyRuleId(`secret-${finding.title}`),
                    confidenceScore: 0.95,
                    engine: ENGINE_NAME,
                })
            );
            const codeFindings = detectCodePatterns(file.path, file.content);
            const configFindings = detectConfigIssues(file.path, file.content).map((finding) =>
                withFindingMetadata(finding, {
                    ruleId: slugifyRuleId(`config-${finding.title}`),
                    confidenceScore: finding.confidence === "high" ? 0.86 : 0.72,
                    engine: ENGINE_NAME,
                })
            );
            analyzerStats.secretFindings += secretFindings.length;
            analyzerStats.codeFindings += codeFindings.length;
            analyzerStats.configFindings += configFindings.length;
            findings.push(...secretFindings, ...codeFindings, ...configFindings);
        }
    }

    const packageJson = fileMap.get("package.json");
    if (packageJson) {
        const dependencyFindings = analyzeDependencies(packageJson, {
            packageLock: fileMap.get("package-lock.json"),
            yarnLock: fileMap.get("yarn.lock"),
            pnpmLock: fileMap.get("pnpm-lock.yaml"),
        });
        analyzerStats.dependencyFindings += dependencyFindings.length;
        findings.push(...dependencyFindings);
    }

    const deduped = dedupeFindings(findings);
    const filtered = deduped.filter((finding) => (finding.confidenceScore ?? confidenceToScore(finding.confidence)) >= confidenceThreshold);

    const aiCandidateFiles = Array.from(
        new Set(
            filtered
                .filter((finding) => (finding.confidenceScore ?? 0) < 0.9 || finding.severity === "critical")
                .map((finding) => finding.file)
        )
    );

    return {
        findings: filtered,
        analyzerStats: {
            ...analyzerStats,
            afterDedup: deduped.length,
            afterConfidenceThreshold: filtered.length,
        },
        aiCandidateFiles,
    };
}
