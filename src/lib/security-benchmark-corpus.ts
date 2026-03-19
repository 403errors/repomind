import { runScanEngineV2 } from "@/lib/security-scanner";

export type SecurityBenchmarkCase = {
    name: string;
    files: Array<{ path: string; content: string }>;
    expectedRuleIds: string[];
};

export const SECURITY_BENCHMARK_CORPUS: SecurityBenchmarkCase[] = [
    {
        name: "sql injection taint flow",
        files: [
            {
                path: "src/sql.ts",
                content: `
                    import { Client } from "pg";
                    const db = new Client();
                    export function handler(req: any) {
                        const id = req.query.id;
                        return db.query(\`SELECT * FROM users WHERE id = \${id}\`);
                    }
                `,
            },
        ],
        expectedRuleIds: ["sqli-tainted-dynamic-query"],
    },
    {
        name: "command injection taint flow",
        files: [
            {
                path: "src/cmd.ts",
                content: `
                    const cp = require("child_process");
                    export function run(req: any) {
                        const cmd = req.query.cmd;
                        cp.exec(cmd);
                    }
                `,
            },
        ],
        expectedRuleIds: ["command-injection-taint"],
    },
    {
        name: "path traversal taint flow",
        files: [
            {
                path: "src/path.ts",
                content: `
                    import fs from "fs";
                    export function read(req: any) {
                        return fs.readFileSync(req.query.path, "utf8");
                    }
                `,
            },
        ],
        expectedRuleIds: ["path-traversal-taint"],
    },
    {
        name: "safe parameterized query",
        files: [
            {
                path: "src/safe-sql.ts",
                content: `
                    import { Client } from "pg";
                    const db = new Client();
                    export function handler(req: any) {
                        return db.query("SELECT * FROM users WHERE id = $1", [req.query.id]);
                    }
                `,
            },
        ],
        expectedRuleIds: [],
    },
    {
        name: "safe execFile usage",
        files: [
            {
                path: "src/safe-cmd.ts",
                content: `
                    const cp = require("child_process");
                    export function run() {
                        cp.execFile("git", ["status"]);
                    }
                `,
            },
        ],
        expectedRuleIds: [],
    },
    // Realistic multi-file signal for auth + sanitizer.
    {
        name: "real-world style sanitized route",
        files: [
            {
                path: "src/api/user.ts",
                content: `
                    import express from "express";
                    import { sanitizeHtml } from "./sanitize";
                    const app = express();
                    app.post("/profile", (req, res) => {
                        const bio = sanitizeHtml(req.body.bio);
                        res.send(bio);
                    });
                `,
            },
            {
                path: "src/api/sanitize.ts",
                content: `
                    export function sanitizeHtml(input: string) {
                        return input.replace(/[<>]/g, "");
                    }
                `,
            },
        ],
        expectedRuleIds: [],
    },
];

export async function runSecurityBenchmarkSuite(threshold = 0.5): Promise<{
    precision: number;
    recall: number;
    truePositiveCount: number;
    falsePositiveCount: number;
    falseNegativeCount: number;
}> {
    let truePositiveCount = 0;
    let falsePositiveCount = 0;
    let falseNegativeCount = 0;

    for (const testCase of SECURITY_BENCHMARK_CORPUS) {
        const result = await runScanEngineV2(testCase.files, {
            profile: "deep",
            confidenceThreshold: threshold,
        });
        const detectedRuleIds = new Set(result.findings.map((finding) => finding.ruleId));

        for (const expected of testCase.expectedRuleIds) {
            if (detectedRuleIds.has(expected)) {
                truePositiveCount += 1;
            } else {
                falseNegativeCount += 1;
            }
        }

        for (const finding of result.findings) {
            const ruleId = finding.ruleId ?? "";
            if (testCase.expectedRuleIds.length === 0 && !testCase.expectedRuleIds.includes(ruleId)) {
                falsePositiveCount += 1;
            }
        }
    }

    const precision = truePositiveCount / Math.max(1, truePositiveCount + falsePositiveCount);
    const recall = truePositiveCount / Math.max(1, truePositiveCount + falseNegativeCount);

    return {
        precision,
        recall,
        truePositiveCount,
        falsePositiveCount,
        falseNegativeCount,
    };
}
