import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SecurityFinding } from "./security-scanner";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Gemini function declarations for security analysis
 */
const securityAnalysisFunctions = [
    {
        name: 'report_sql_injection',
        description: 'Report a potential SQL injection vulnerability',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'File path' },
                line: { type: 'number', description: 'Approximate line number' },
                code_snippet: { type: 'string', description: 'Vulnerable code snippet' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                explanation: { type: 'string', description: 'Why this is vulnerable' }
            },
            required: ['file', 'code_snippet', 'severity', 'explanation']
        }
    },
    {
        name: 'report_xss',
        description: 'Report a potential XSS (Cross-Site Scripting) vulnerability',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'File path' },
                line: { type: 'number', description: 'Approximate line number' },
                code_snippet: { type: 'string', description: 'Vulnerable code snippet' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                explanation: { type: 'string', description: 'Why this is vulnerable' }
            },
            required: ['file', 'code_snippet', 'severity', 'explanation']
        }
    },
    {
        name: 'report_auth_issue',
        description: 'Report an authentication or authorization vulnerability',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'File path' },
                line: { type: 'number', description: 'Approximate line number' },
                code_snippet: { type: 'string', description: 'Vulnerable code snippet' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                explanation: { type: 'string', description: 'What\'s wrong with the auth/authz' }
            },
            required: ['file', 'code_snippet', 'severity', 'explanation']
        }
    },
    {
        name: 'report_injection',
        description: 'Report a code injection, command injection, or path traversal vulnerability',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'File path' },
                line: { type: 'number', description: 'Approximate line number' },
                code_snippet: { type: 'string', description: 'Vulnerable code snippet' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                injection_type: { type: 'string', enum: ['command', 'path_traversal', 'code', 'ldap'] },
                explanation: { type: 'string', description: 'How the injection could occur' }
            },
            required: ['file', 'code_snippet', 'severity', 'injection_type', 'explanation']
        }
    },
    {
        name: 'report_crypto_issue',
        description: 'Report insecure cryptography usage',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'File path' },
                line: { type: 'number', description: 'Approximate line number' },
                code_snippet: { type: 'string', description: 'Problematic code' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                issue_type: { type: 'string', enum: ['weak_algorithm', 'hardcoded_key', 'no_encryption', 'insecure_random'] },
                explanation: { type: 'string', description: 'What\'s wrong with the crypto' }
            },
            required: ['file', 'code_snippet', 'severity', 'issue_type', 'explanation']
        }
    }
];

/**
 * Analyze code files with Gemini AI for security vulnerabilities
 */
export async function analyzeCodeWithGemini(
    files: Array<{ path: string; content: string }>
): Promise<SecurityFinding[]> {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            tools: [{ functionDeclarations: securityAnalysisFunctions as any }]
        });

        // Build analysis prompt
        const filesContext = files.map(f => `
--- FILE: ${f.path} ---
\`\`\`
${f.content.slice(0, 3000)} ${f.content.length > 3000 ? '... (truncated)' : ''}
\`\`\`
    `).join('\n');

        const prompt = `
You are a security expert analyzing code for CRITICAL vulnerabilities ONLY.

${filesContext}

CRITICAL RULES TO PREVENT FALSE POSITIVES:
1. **RegExp.exec() is NOT child_process.exec()** - Never flag regex operations as command injection
2. **String concatenation for display is NOT SQL injection** - Only flag if:
   - User input (req., params., query., body.) flows DIRECTLY into SQL
   - Database library is imported (mysql, postgres, sequelize, typeorm, etc.)
3. **Verify actual vulnerability path** - Input must flow to a dangerous sink
4. **Check for imports** - Don't flag child_process.exec if child_process isn't imported
5. **No false positives** - When in doubt, DO NOT report

Only use reporting functions for TRUE vulnerabilities where:
- User-controlled input exists (req.*, params.*, query.*, body.*)
- Input flows to a dangerous operation (SQL, exec, innerHTML, etc.)
- No sanitization or validation is present
- The dangerous module/library is actually imported

Be extremely conservative. False alarms erode trust.
`;

        const result = await model.generateContent(prompt);
        const response = result.response;

        // Extract function calls
        const functionCalls = response.functionCalls?.() || [];

        const findings: SecurityFinding[] = functionCalls
            .map((call: any) => {
                const args = call.args as any;
                let title = '';
                let cwe = '';
                let recommendation = '';

                switch (call.name) {
                    case 'report_sql_injection':
                        title = 'SQL Injection Vulnerability';
                        cwe = 'CWE-89';
                        recommendation = 'Use parameterized queries or prepared statements. Never concatenate user input into SQL.';
                        break;
                    case 'report_xss':
                        title = 'Cross-Site Scripting (XSS)';
                        cwe = 'CWE-79';
                        recommendation = 'Sanitize user input and use secure DOM manipulation methods. Avoid innerHTML with user data.';
                        break;
                    case 'report_auth_issue':
                        title = 'Authentication/Authorization Issue';
                        cwe = 'CWE-287';
                        recommendation = 'Implement proper authentication checks and use established auth libraries.';
                        break;
                    case 'report_injection':
                        title = `${args.injection_type} Injection`;
                        cwe = args.injection_type === 'command' ? 'CWE-78' : 'CWE-22';
                        recommendation = 'Validate and sanitize all user input. Use safe APIs that don\'t accept shell commands.';
                        break;
                    case 'report_crypto_issue':
                        title = `Cryptography Issue: ${args.issue_type}`;
                        cwe = 'CWE-327';
                        recommendation = 'Use modern cryptographic algorithms (AES-256, SHA-256+). Never hardcode keys.';
                        break;
                }

                return {
                    type: 'code' as const,
                    severity: args.severity,
                    title,
                    description: args.explanation,
                    file: args.file,
                    line: args.line,
                    recommendation,
                    cwe,
                    confidence: 'high' as const, // AI findings start with high confidence
                };
            })
            .filter(finding => validateFinding(finding, files)); // Post-process validation

        return findings;
    } catch (error: any) {
        console.error('Gemini security analysis error:', error);
        console.error('Error details:', {
            message: error?.message,
            status: error?.status,
            statusText: error?.statusText
        });
        // Return empty array instead of throwing to allow graceful degradation
        return [];
    }
}

function extractJsonPayload(text: string): string | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
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
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash'
        });

        const contextSnippet = params.snippet || '';
        const lineInfo = params.line ? `Line: ${params.line}` : 'Line: unknown';

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
${params.fileContent.length > 8000 ? '\n... (truncated)' : ''}
\`\`\`

Return ONLY valid JSON with keys:
- "patch": a unified diff with --- a/${params.filePath} and +++ b/${params.filePath}
- "explanation": a short explanation of the fix

Do not include markdown fences.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonPayload = extractJsonPayload(text);
        if (!jsonPayload) {
            return { patch: text.trim(), explanation: 'Model response did not include JSON.' };
        }

        const parsed = JSON.parse(jsonPayload);
        return {
            patch: String(parsed.patch || '').trim(),
            explanation: String(parsed.explanation || '').trim()
        };
    } catch (error: any) {
        console.error('Gemini patch generation error:', error);
        return {
            patch: '',
            explanation: 'Failed to generate patch.'
        };
    }
}

/**
 * Validate AI findings to prevent false positives
 */
function validateFinding(
    finding: SecurityFinding,
    files: Array<{ path: string; content: string }>
): boolean {
    const file = files.find(f => f.path === finding.file);
    if (!file) return false;

    // Validate command injection findings
    if (finding.title.toLowerCase().includes('command') || finding.title.toLowerCase().includes('injection')) {
        // Reject if it's actually about RegExp.exec
        if (/regexp.*exec/i.test(finding.description)) {
            return false;
        }
        // Reject if child_process isn't imported
        if (!/(?:require|import).*['"]child_process['"]/.test(file.content)) {
            return false;
        }
    }

    // Validate SQL injection findings
    if (finding.title.toLowerCase().includes('sql')) {
        // Reject if no database library is imported
        if (!/(?:require|import).*(?:mysql|postgres|sqlite|sequelize|knex|typeorm|mongodb|mongoose)/i.test(file.content)) {
            return false;
        }
        // Reject if it's just string concatenation for display/logging
        if (/console\.|log\(|print\(/i.test(finding.description)) {
            return false;
        }
    }

    return true;
}
