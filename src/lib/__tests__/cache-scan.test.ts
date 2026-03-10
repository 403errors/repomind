import { describe, expect, it, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";

const { setexMock, getMock } = vi.hoisted(() => ({
    setexMock: vi.fn(),
    getMock: vi.fn(),
}));

vi.mock("@vercel/kv", () => ({
    kv: {
        setex: setexMock,
        get: getMock,
    },
}));

import { cacheSecurityScanResult, getCachedSecurityScanResult } from "@/lib/cache";

describe("security scan cache helpers", () => {
    beforeEach(() => {
        setexMock.mockReset();
        getMock.mockReset();
    });

    it("stores scan results with 7-day TTL and revision-aware key", async () => {
        setexMock.mockResolvedValue("OK");

        await cacheSecurityScanResult(
            "acme",
            "widget",
            {
                scanKey: "security_scan",
                files: ["src/b.ts", "src/a.ts"],
                revision: "abc123",
                scanConfig: { analysisProfile: "quick", aiAssist: "off" },
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
            },
            { findings: [], summary: { total: 0 } }
        );

        expect(setexMock).toHaveBeenCalledTimes(1);
        const [key, ttl] = setexMock.mock.calls[0];
        expect(key).toContain("scan_answer:acme/widget:v2:");
        expect(ttl).toBe(604800);
    });

    it("reads back and parses cached scan JSON", async () => {
        const payload = JSON.stringify({ ok: true, total: 2 });
        const compressed = gzipSync(Buffer.from(payload));
        getMock.mockResolvedValue(`gz:${compressed.toString("base64")}`);

        const result = await getCachedSecurityScanResult(
            "acme",
            "widget",
            {
                scanKey: "security_scan",
                files: ["src/a.ts"],
                revision: "abc123",
                scanConfig: { analysisProfile: "quick", aiAssist: "off" },
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
            }
        );

        expect(result).toEqual({ ok: true, total: 2 });
    });

    it("uses scan config as part of cache identity", async () => {
        setexMock.mockResolvedValue("OK");

        await cacheSecurityScanResult(
            "acme",
            "widget",
            {
                scanKey: "security_scan",
                files: ["src/a.ts"],
                revision: "abc123",
                scanConfig: { analysisProfile: "quick", aiAssist: "off" },
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
            },
            { findings: [] }
        );
        await cacheSecurityScanResult(
            "acme",
            "widget",
            {
                scanKey: "security_scan",
                files: ["src/a.ts"],
                revision: "abc123",
                scanConfig: { analysisProfile: "quick", aiAssist: "on" },
                engineVersion: "scan-engine-v2",
                cacheKeyVersion: "v2",
            },
            { findings: [] }
        );

        const firstKey = setexMock.mock.calls[0]?.[0];
        const secondKey = setexMock.mock.calls[1]?.[0];
        expect(firstKey).not.toBe(secondKey);
    });
});
