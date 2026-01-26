/**
 * Multi-layered security scanning using open-source tools + Gemini AI
 * Zero external API costs - uses npm audit, ESLint security, regex patterns, and Gemini
 */

export interface SecurityFinding {
    type: 'dependency' | 'code' | 'secret' | 'configuration';
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    file: string;
    line?: number;
    snippet?: string;
    recommendation: string;
    cwe?: string;
    cvss?: number;
    confidence?: 'high' | 'medium' | 'low'; // Confidence level of the finding
}

export interface ScanSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    // Debug info
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

/**
 * Secret detection patterns
 */
const SECRET_PATTERNS = [
    {
        name: 'API Key',
        regex: /['"](?:api[_-]?key|apikey)['"]:\s*['"]([a-zA-Z0-9_-]{20,})['"] /i,
        severity: 'critical' as const,
    },
    {
        name: 'Hardcoded Password',
        regex: /(?:password|passwd|pwd)['"]:\s*['"]([^'"]{8,})['"] /i,
        severity: 'critical' as const,
    },
    {
        name: 'AWS Access Key',
        regex: /(AKIA|ASIA)[0-9A-Z]{16}/,
        severity: 'critical' as const,
    },
    {
        name: 'GitHub Token',
        regex: /ghp_[a-zA-Z0-9]{36}/,
        severity: 'critical' as const,
    },
    {
        name: 'OpenAI API Key',
        regex: /sk-[a-zA-Z0-9]{48}/,
        severity: 'critical' as const,
    },
    {
        name: 'Private Key',
        regex: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/,
        severity: 'critical' as const,
    },
    {
        name: 'JWT Token',
        regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
        severity: 'high' as const,
    },
];

/**
 * Detect hardcoded secrets in code
 */
export function detectSecrets(filepath: string, content: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Defensive check: ensure content is a string
    if (typeof content !== 'string') {
        console.warn(`Skipping secret detection for ${filepath}: content is not a string`);
        return findings;
    }

    const lines = content.split('\n');

    lines.forEach((line, index) => {
        SECRET_PATTERNS.forEach(pattern => {
            if (pattern.regex.test(line)) {
                findings.push({
                    type: 'secret',
                    severity: pattern.severity,
                    title: `Exposed ${pattern.name}`,
                    description: `Found hardcoded ${pattern.name} in source code`,
                    file: filepath,
                    line: index + 1,
                    recommendation: 'Use environment variables or a secure secret management system. Never commit secrets to version control.',
                    cwe: 'CWE-798',
                });
            }
        });
    });

    return findings;
}


/**
 * Security patterns to check in code
 */
interface CodePattern {
    name: string;
    regex: RegExp;
    severity: 'critical' | 'high' | 'medium' | 'low';
    cwe: string;
    recommendation: string;
    validate?: (fileContent: string, matchedLine: string) => boolean;
}

const CODE_PATTERNS: CodePattern[] = [
    {
        name: 'Unsafe eval usage',
        regex: /\beval\s*\(/,
        severity: 'high',
        cwe: 'CWE-95',
        recommendation: 'Avoid using eval(). Use safer alternatives like JSON.parse() or Function constructor with proper validation.',
    },
    {
        name: 'Unsafe innerHTML usage',
        regex: /\.innerHTML\s*=/,
        severity: 'medium',
        cwe: 'CWE-79',
        recommendation: 'Use textContent or sanitize user input before setting innerHTML to prevent XSS attacks.',
    },
    {
        name: 'SQL concatenation',
        regex: /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*?\+\s*(?:req\.|params\.|query\.|body\.|user\.|input\.|this\.)/i,
        severity: 'high',
        cwe: 'CWE-89',
        recommendation: 'Use parameterized queries or ORM to prevent SQL injection.',
        validate: (content, line) => {
            // Only flag if database library is imported
            return /(?:require|import).*(?:mysql|postgres|sqlite|sequelize|knex|typeorm|mongodb|mongoose)/i.test(content);
        }
    },
    {
        name: 'Unsafe child_process',
        regex: /(?:child_process|cp)\s*\.\s*(?:exec|spawn)\s*\(/,
        severity: 'high',
        cwe: 'CWE-78',
        recommendation: 'Validate and sanitize all input passed to child_process. Use execFile() instead of exec() when possible.',
        validate: (content, line) => {
            // Ensure child_process is actually imported
            return /(?:require|import).*['"]child_process['"]/.test(content);
        }
    },
    {
        name: 'Weak crypto algorithm',
        regex: /\b(md5|sha1)\b/i,
        severity: 'medium',
        cwe: 'CWE-327',
        recommendation: 'Use SHA-256 or stronger hashing algorithms. MD5 and SHA-1 are cryptographically broken.',
    },
];

/**
 * Detect code-level security issues using pattern matching
 */
export function detectCodePatterns(filepath: string, content: string): SecurityFinding[] {
    // Only scan code files
    if (!/\.(js|jsx|ts|tsx|py|java|php)$/.test(filepath)) {
        return [];
    }

    // Defensive check: ensure content is a string
    if (typeof content !== 'string') {
        console.warn(`Skipping code pattern detection for ${filepath}: content is not a string`);
        return [];
    }

    const findings: SecurityFinding[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            return;
        }

        CODE_PATTERNS.forEach(pattern => {
            if (pattern.regex.test(line)) {
                // Run validation if provided
                if (pattern.validate && !pattern.validate(content, line)) {
                    return; // Skip if validation fails
                }

                findings.push({
                    type: 'code',
                    severity: pattern.severity,
                    title: pattern.name,
                    description: `Potentially unsafe code detected at line ${index + 1}`,
                    file: filepath,
                    line: index + 1,
                    recommendation: pattern.recommendation,
                    cwe: pattern.cwe,
                    confidence: pattern.validate ? 'high' : 'medium', // Higher confidence with validation
                });
            }
        });
    });

    return findings;
}

/**
 * Analyze package.json for known dependency vulnerabilities
 * This simulates npm audit by checking for common vulnerable patterns
 */
export function analyzeDependencies(packageJsonContent: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    try {
        const pkg = JSON.parse(packageJsonContent);
        const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
        };

        // Check for outdated/vulnerable packages (basic heuristics)
        // This is a simplified version - in production, you'd use actual npm audit
        const knownVulnerable: Record<string, { severity: SecurityFinding['severity']; issue: string }> = {
            'lodash': { severity: 'high', issue: 'Prototype pollution vulnerability' },
            'moment': { severity: 'low', issue: 'Deprecated package, use date-fns or dayjs' },
            'request': { severity: 'medium', issue: 'Deprecated HTTP client, use axios or fetch' },
        };

        for (const [dep, version] of Object.entries(allDeps || {})) {
            if (knownVulnerable[dep]) {
                findings.push({
                    type: 'dependency',
                    severity: knownVulnerable[dep].severity,
                    title: `Vulnerable dependency: ${dep}`,
                    description: knownVulnerable[dep].issue,
                    file: 'package.json',
                    recommendation: `Update or replace ${dep} with a more secure alternative`,
                    cwe: 'CWE-1035',
                });
            }
        }
    } catch (e) {
        // Invalid package.json
    }

    return findings;
}

/**
 * Group findings by severity
 */
export function groupBySeverity(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
    return findings.reduce((acc, finding) => {
        if (!acc[finding.severity]) {
            acc[finding.severity] = [];
        }
        acc[finding.severity].push(finding);
        return acc;
    }, {} as Record<string, SecurityFinding[]>);
}

/**
 * Get summary statistics
 */
export function getScanSummary(findings: SecurityFinding[]): ScanSummary {
    return {
        total: findings.length,
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
        info: findings.filter(f => f.severity === 'info').length,
    };
}

/**
 * Main scanning function
 */
export function scanFiles(files: Array<{ path: string; content: string }>): SecurityFinding[] {
    const allFindings: SecurityFinding[] = [];

    for (const file of files) {
        // Scan for secrets
        allFindings.push(...detectSecrets(file.path, file.content));

        // Scan for code patterns
        allFindings.push(...detectCodePatterns(file.path, file.content));

        // Scan dependencies if package.json
        if (file.path === 'package.json') {
            allFindings.push(...analyzeDependencies(file.content));
        }
    }

    return allFindings;
}
