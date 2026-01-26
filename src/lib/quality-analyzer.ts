import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface QualityMetrics {
    complexity: number;
    maintainability: number; // 0-100
    loc: number;
    functionCount: number;
}

export interface CodeIssue {
    type: 'complexity' | 'style' | 'potential_bug' | 'best_practice';
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    line: number;
    suggestion: string;
}

export interface QualityReport {
    metrics: QualityMetrics;
    issues: CodeIssue[];
    score: number; // 0-100
    summary: string;
}

/**
 * Calculate Cyclomatic Complexity using Babel AST
 */
function calculateComplexity(code: string): number {
    try {
        const ast = parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy']
        });

        let complexity = 1; // Base complexity

        traverse(ast, {
            IfStatement() { complexity++; },
            ForStatement() { complexity++; },
            ForInStatement() { complexity++; },
            ForOfStatement() { complexity++; },
            WhileStatement() { complexity++; },
            DoWhileStatement() { complexity++; },
            CatchClause() { complexity++; },
            ConditionalExpression() { complexity++; }, // Ternary
            LogicalExpression(path: any) {
                if (path.node.operator === '||' || path.node.operator === '&&') {
                    complexity++;
                }
            },
            SwitchCase(path: any) {
                if (path.node.test) { // Exclude default case
                    complexity++;
                }
            }
        });

        return complexity;
    } catch (e) {
        console.warn('Complexity calculation failed:', e);
        return 1;
    }
}

/**
 * Analyze code quality using AST metrics + Gemini AI
 */
export async function analyzeCodeQuality(
    code: string,
    filename: string
): Promise<QualityReport> {
    // 1. Calculate Static Metrics
    const complexity = calculateComplexity(code);
    const loc = code.split('\n').length;
    const functionCount = (code.match(/function\s+\w+|=>|\w+\s*\([^)]*\)\s*\{/g) || []).length;

    // Simple maintainability index approximation
    // MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    // Simplified: 100 - (complexity * 2) - (loc / 20)
    let maintainability = Math.max(0, Math.min(100, 100 - (complexity * 1.5) - (loc / 50)));

    const metrics: QualityMetrics = {
        complexity,
        maintainability: Math.round(maintainability),
        loc,
        functionCount
    };

    // 2. AI Qualitative Analysis (Zero-Cost Linter)
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
      You are a senior code reviewer. Analyze this code file (${filename}) for quality issues.
      
      Metrics Context:
      - Cyclomatic Complexity: ${complexity} (High if > 10)
      - Lines of Code: ${loc}
      
      Code:
      \`\`\`${filename.split('.').pop()}
      ${code.slice(0, 8000)}
      \`\`\`
      
      Provide a JSON response with:
      1. A quality score (0-100)
      2. A brief summary (max 2 sentences)
      3. A list of specific issues (max 5) with line numbers, severity, and suggestions.
      
      Format:
      {
        "score": number,
        "summary": "string",
        "issues": [
          { "type": "complexity"|"style"|"potential_bug"|"best_practice", "severity": "critical"|"high"|"medium"|"low", "message": "string", "line": number, "suggestion": "string" }
        ]
      }
    `;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const aiReport = parseAiJson(text);
        if (aiReport) {
            return {
                metrics,
                score: aiReport.score,
                summary: aiReport.summary,
                issues: aiReport.issues
            };
        }
    } catch (error) {
        console.error('AI analysis failed:', error);
    }

    // Fallback if AI fails
    return {
        metrics,
        score: Math.round(maintainability),
        summary: `Static analysis shows complexity of ${complexity} and ${loc} lines of code.`,
        issues: complexity > 10 ? [{
            type: 'complexity',
            severity: 'medium',
            message: 'High cyclomatic complexity detected',
            line: 1,
            suggestion: 'Consider breaking down complex functions'
        }] : []
    };
}

function parseAiJson(text: string): any | null {
    const stripped = text
        .replace(/```json/g, '```')
        .replace(/```/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");

    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

    const raw = stripped.slice(firstBrace, lastBrace + 1);
    const cleaned = raw.replace(/,\s*([}\]])/g, '$1');

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('AI JSON parse failed:', error);
        return null;
    }
}
