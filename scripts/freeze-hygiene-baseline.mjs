import fs from "fs";
import path from "path";

const root = process.cwd();
const artifactsDir = path.join(root, ".codex-artifacts");

function readRequiredFile(fileName) {
    const filePath = path.join(artifactsDir, fileName);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Required artifact not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8");
}

function parseLintSummary(lintOutput) {
    const match = lintOutput.match(/✖\s+(\d+)\s+problems\s+\((\d+)\s+errors,\s+(\d+)\s+warnings\)/);
    if (!match) {
        return { total: 0, errors: 0, warnings: 0 };
    }
    return {
        total: Number(match[1]),
        errors: Number(match[2]),
        warnings: Number(match[3]),
    };
}

function countTypeErrors(tscOutput) {
    return (tscOutput.match(/error TS\d+:/g) ?? []).length;
}

const findings = JSON.parse(readRequiredFile("hygiene-findings.json"));
const lintOutput = readRequiredFile("lint-output.txt");
const tscOutput = readRequiredFile("tsc-output.txt");

const baseline = {
    generatedAt: new Date().toISOString(),
    summary: {
        filesScanned: findings.summary.files_scanned,
        duplicateClusters: findings.summary.duplicate_clusters,
        unusedFunctionCandidates: findings.summary.unused_function_candidates,
        deadCodeCandidates: findings.summary.dead_code_candidates,
        optimizationHotspots: findings.summary.optimization_hotspots,
    },
    lint: parseLintSummary(lintOutput),
    typecheck: {
        errors: countTypeErrors(tscOutput),
    },
    inputs: [
        ".codex-artifacts/hygiene-findings.json",
        ".codex-artifacts/lint-output.txt",
        ".codex-artifacts/tsc-output.txt",
    ],
};

const outputPath = path.join(artifactsDir, "baseline-summary.json");
fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Wrote baseline snapshot: ${outputPath}`);
