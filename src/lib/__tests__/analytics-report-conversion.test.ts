import { beforeEach, describe, expect, it, vi } from "vitest";

type PipelineCall = { type: string; key: string };

const {
    pipelineCalls,
    scardMock,
    getMock,
    smembersMock,
    keysMock,
    execInfoMock,
    lrangeMock,
    pipelineExecMock,
    userFindManyMock,
    repoScanGroupByMock,
    recentSearchGroupByMock,
    chatGroupByMock,
    reportFalsePositiveFindManyMock,
    reportFalsePositiveGroupByMock,
} = vi.hoisted(() => ({
    pipelineCalls: [] as PipelineCall[],
    scardMock: vi.fn(),
    getMock: vi.fn(),
    smembersMock: vi.fn(),
    keysMock: vi.fn(),
    execInfoMock: vi.fn(),
    lrangeMock: vi.fn(),
    pipelineExecMock: vi.fn(),
    userFindManyMock: vi.fn(),
    repoScanGroupByMock: vi.fn(),
    recentSearchGroupByMock: vi.fn(),
    chatGroupByMock: vi.fn(),
    reportFalsePositiveFindManyMock: vi.fn(),
    reportFalsePositiveGroupByMock: vi.fn(),
}));

vi.mock("@vercel/kv", () => ({
    kv: {
        scard: scardMock,
        get: getMock,
        smembers: smembersMock,
        keys: keysMock,
        exec: execInfoMock,
        lrange: lrangeMock,
        pipeline: () => {
            const localCalls: PipelineCall[] = [];
            const pipeline = {
                get: (key: string) => {
                    localCalls.push({ type: "get", key });
                    return pipeline;
                },
                hgetall: (key: string) => {
                    localCalls.push({ type: "hgetall", key });
                    return pipeline;
                },
                incr: (key: string) => {
                    localCalls.push({ type: "incr", key });
                    return pipeline;
                },
                incrby: (key: string) => {
                    localCalls.push({ type: "incrby", key });
                    return pipeline;
                },
                del: (key: string) => {
                    localCalls.push({ type: "del", key });
                    return pipeline;
                },
                expire: (key: string) => {
                    localCalls.push({ type: "expire", key });
                    return pipeline;
                },
                lpush: () => pipeline,
                ltrim: () => pipeline,
                sadd: () => pipeline,
                hset: () => pipeline,
                hincrby: () => pipeline,
                exec: async () => {
                    pipelineCalls.push(...localCalls);
                    return pipelineExecMock(localCalls);
                },
            };
            return pipeline;
        },
    },
}));

vi.mock("@/lib/db", () => ({
    prisma: {
        user: {
            findMany: userFindManyMock,
        },
        repoScan: {
            groupBy: repoScanGroupByMock,
        },
        recentSearch: {
            groupBy: recentSearchGroupByMock,
        },
        chatConversation: {
            groupBy: chatGroupByMock,
        },
        reportFalsePositive: {
            findMany: reportFalsePositiveFindManyMock,
            groupBy: reportFalsePositiveGroupByMock,
        },
    },
}));

import { getAnalyticsData, resetReportConversionMetrics, trackReportConversionEvent } from "@/lib/analytics";

describe("report conversion analytics", () => {
    beforeEach(() => {
        pipelineCalls.length = 0;
        scardMock.mockReset();
        getMock.mockReset();
        smembersMock.mockReset();
        keysMock.mockReset();
        execInfoMock.mockReset();
        lrangeMock.mockReset();
        pipelineExecMock.mockReset();
        userFindManyMock.mockReset();
        repoScanGroupByMock.mockReset();
        recentSearchGroupByMock.mockReset();
        chatGroupByMock.mockReset();
        reportFalsePositiveFindManyMock.mockReset();
        reportFalsePositiveGroupByMock.mockReset();

        scardMock.mockResolvedValue(0);
        getMock.mockResolvedValue(0);
        smembersMock.mockResolvedValue([]);
        keysMock.mockResolvedValue([]);
        execInfoMock.mockResolvedValue("total_data_size:0");
        lrangeMock.mockResolvedValue([]);
        pipelineExecMock.mockResolvedValue([]);
        userFindManyMock.mockResolvedValue([]);
        repoScanGroupByMock.mockResolvedValue([]);
        recentSearchGroupByMock.mockResolvedValue([]);
        chatGroupByMock.mockResolvedValue([]);
        reportFalsePositiveFindManyMock.mockResolvedValue([]);
        reportFalsePositiveGroupByMock.mockResolvedValue([]);
    });

    it("tracks report conversion with total and daily counters", async () => {
        await trackReportConversionEvent("report_fix_chat_started", "scan_123");

        const incrementedKeys = pipelineCalls.filter((c) => c.type === "incr").map((c) => c.key);
        expect(incrementedKeys).toContain("stats:report:report_fix_chat_started");
        expect(incrementedKeys.some((key) => key.startsWith("stats:report:report_fix_chat_started:"))).toBe(true);
        expect(incrementedKeys).toContain("stats:report:scan:scan_123:report_fix_chat_started");
    });

    it("skips report conversion for the configured admin", async () => {
        process.env.ADMIN_GITHUB_USERNAME = "403errors";

        await trackReportConversionEvent("report_fix_chat_started", "scan_123", {
            actorUsername: "403errors",
        });

        expect(pipelineCalls.filter((c) => c.type === "incr")).toEqual([]);
    });

    it("resets report funnel metrics", async () => {
        keysMock.mockResolvedValue([
            "stats:report:report_viewed_shared",
            "stats:report:report_fix_chat_started:2026-03-09",
        ]);

        await resetReportConversionMetrics();

        expect(pipelineCalls.filter((c) => c.type === "del").map((c) => c.key)).toEqual([
            "stats:report:report_viewed_shared",
            "stats:report:report_fix_chat_started:2026-03-09",
        ]);
    });

    it("returns report funnel metrics in analytics payload", async () => {
        const data = await getAnalyticsData();

        expect(data.reportFunnel).toBeDefined();
        expect(data.reportFunnel?.weeklyConversionRate).toBeGreaterThanOrEqual(0);
        expect(data.reportFunnel?.weeklyFalsePositiveRate).toBeGreaterThanOrEqual(0);
        expect(data.reportFunnel?.weeklyExpiredLinkFailures).toBeGreaterThanOrEqual(0);
        expect(data.reportFunnel?.totals.report_viewed_shared).toBeGreaterThanOrEqual(0);
        expect(data.falsePositiveReview?.recentSubmissions).toEqual([]);
    });
});
