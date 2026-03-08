import { describe, expect, it } from "vitest";

import { runScanEngineV2 } from "@/lib/security-scanner";

type BenchmarkCase = {
    name: string;
    file: string;
    content: string;
    expectedRuleIds: string[];
};

const cases: BenchmarkCase[] = [
    {
        name: "sql injection taint flow",
        file: "src/sql.ts",
        content: `
            import { Client } from "pg";
            const db = new Client();
            export function handler(req: any) {
                const id = req.query.id;
                return db.query(\`SELECT * FROM users WHERE id = \${id}\`);
            }
        `,
        expectedRuleIds: ["sqli-tainted-dynamic-query"],
    },
    {
        name: "command injection taint flow",
        file: "src/cmd.ts",
        content: `
            const cp = require("child_process");
            export function run(req: any) {
                const cmd = req.query.cmd;
                cp.exec(cmd);
            }
        `,
        expectedRuleIds: ["command-injection-taint"],
    },
    {
        name: "path traversal taint flow",
        file: "src/path.ts",
        content: `
            import fs from "fs";
            export function read(req: any) {
                return fs.readFileSync(req.query.path, "utf8");
            }
        `,
        expectedRuleIds: ["path-traversal-taint"],
    },
    {
        name: "safe parameterized query",
        file: "src/safe-sql.ts",
        content: `
            import { Client } from "pg";
            const db = new Client();
            export function handler(req: any) {
                return db.query("SELECT * FROM users WHERE id = $1", [req.query.id]);
            }
        `,
        expectedRuleIds: [],
    },
    {
        name: "safe execFile usage",
        file: "src/safe-cmd.ts",
        content: `
            const cp = require("child_process");
            export function run() {
                cp.execFile("git", ["status"]);
            }
        `,
        expectedRuleIds: [],
    },
];

describe("security benchmark harness", () => {
    it("meets precision/recall quality gate on benchmark corpus", () => {
        let truePositiveCount = 0;
        let falsePositiveCount = 0;
        let falseNegativeCount = 0;

        for (const testCase of cases) {
            const result = runScanEngineV2(
                [{ path: testCase.file, content: testCase.content }],
                { profile: "deep", confidenceThreshold: 0.5 }
            );
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

        expect(precision).toBeGreaterThanOrEqual(0.75);
        expect(recall).toBeGreaterThanOrEqual(0.75);
    });
});
