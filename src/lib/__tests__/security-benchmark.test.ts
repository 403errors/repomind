import { describe, expect, it } from "vitest";
import { runSecurityBenchmarkSuite } from "@/lib/security-benchmark-corpus";

describe("security benchmark harness", () => {
    it("meets precision/recall quality gate on benchmark corpus", async () => {
        const { precision, recall } = await runSecurityBenchmarkSuite(0.5);

        expect(precision).toBeGreaterThanOrEqual(0.75);
        expect(recall).toBeGreaterThanOrEqual(0.75);
    });
});
