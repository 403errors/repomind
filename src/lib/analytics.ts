import { kv } from "@vercel/kv";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import type { FalsePositiveReviewSummary } from "@/lib/services/report-false-positives";
import { getFalsePositiveReviewSummary } from "@/lib/services/report-false-positives";

export interface KVUsagePoint {
    timestamp: number;
    size: number; // bytes
}

export interface AnalyticsData {
    totalVisitors: number;
    totalQueries: number;
    activeUsers24h: number;
    totalLoggedInUsers: number;
    deviceStats: Record<string, number>;
    countryStats: Record<string, number>;
    recentVisitors: VisitorData[];
    loggedInUsers: LoggedInUserData[];
    kvStats?: {
        currentSize: number;
        maxSize: number;
        history: KVUsagePoint[];
    };
    searchPerformance?: {
        byWindow: Record<SelectionPerformanceWindow, SelectionPerformanceMetrics>;
    };
    reportFunnel?: ReportFunnelMetrics;
    falsePositiveReview?: FalsePositiveReviewSummary;
}

export interface VisitorData {
    id: string;
    country: string;
    device: string;
    lastSeen: number;
    queryCount: number;
    firstSeen: number;
}

export interface LoggedInUserData {
    id: string;
    email: string | null;
    githubLogin: string | null;
    queryCount: number;
    scanCount: number;
    searchCount: number;
    chatCount: number;
    createdAt: number;
    lastActivityAt: number | null;
}

export type SelectionPerformanceWindow = "24h" | "7d";

export interface SelectionPerformanceMetrics {
    avgSelectionMs: number;
    indexHitRate: number;
    fallbackRate: number;
    selections: number;
}

export const REPORT_CONVERSION_EVENTS = [
    "report_viewed_shared",
    "report_fix_prompt_copied",
    "report_fix_prompt_previewed",
    "report_fix_login_gate_shown",
    "report_fix_login_completed",
    "report_fix_chat_started",
    "report_false_positive_flagged",
    "report_shared_link_invalid",
    "report_expired_viewed",
    // Legacy keys kept for backwards compatibility with historical tracking.
    "report_fix_in_chat_clicked",
    "report_discuss_in_chat_clicked",
    "report_create_pr_clicked",
    "report_create_pr_login_completed",
    "report_create_pr_phase2_waitlist_shown",
] as const;

export type ReportConversionEvent = (typeof REPORT_CONVERSION_EVENTS)[number];

export interface ReportFunnelMetrics {
    totals: Record<ReportConversionEvent, number>;
    weekly: Record<ReportConversionEvent, number>;
    weeklyConversionRate: number;
    weeklyFalsePositiveRate: number;
    weeklyExpiredLinkFailures: number;
}

interface ReportConversionTrackingOptions {
    actorUsername?: string | null;
}

/**
 * Fetch and parse KV info for storage stats
 */
async function getKVStats(): Promise<{ currentSize: number, maxSize: number }> {
    try {
        const info = await kv.exec(['INFO']) as string;

        // Parse "total_data_size" and "max_data_size"
        const totalSizeMatch = info.match(/total_data_size:(\d+)/);
        return {
            currentSize: totalSizeMatch ? parseInt(totalSizeMatch[1], 10) : 0,
            maxSize: 256 * 1024 * 1024 // Final corrected limit: 256MB
        };
    } catch (error) {
        console.error("Failed to fetch KV stats:", error);
        return { currentSize: 0, maxSize: 256 * 1024 * 1024 };
    }
}

/**
 * Record current KV usage in history list
 */
async function recordKVUsageHistory(currentSize: number): Promise<KVUsagePoint[]> {
    const HISTORY_KEY = "stats:kv:history";
    const MAX_HISTORY = 5000; // ~100 days @ 30 min intervals
    const INTERVAL = 30 * 60 * 1000; // 30 mins
    const now = Date.now();

    try {
        // Get the last point to check for throttling
        const lastPoints = await kv.lrange(HISTORY_KEY, 0, 0) as KVUsagePoint[];
        let shouldAdd = true;

        if (lastPoints && lastPoints.length > 0) {
            const lastPoint = lastPoints[0];
            if (now - lastPoint.timestamp < INTERVAL) {
                shouldAdd = false;
            }
        }

        if (shouldAdd) {
            const newPoint: KVUsagePoint = { timestamp: now, size: currentSize };
            const pipeline = kv.pipeline();
            pipeline.lpush(HISTORY_KEY, newPoint);
            pipeline.ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1);
            await pipeline.exec();
        }

        // Return the full history
        const history = await kv.lrange(HISTORY_KEY, 0, MAX_HISTORY - 1) as KVUsagePoint[];
        return history.reverse(); // Reverse so it's chronological for the graph
    } catch (error) {
        console.error("Failed to record KV history:", error);
        return [];
    }
}

/**
 * Track an anonymous visitor event (e.g., query) in KV.
 * Only tracks if the ID starts with 'anon_'.
 */
export async function trackEvent(
    visitorId: string,
    eventType: 'query' | 'visit',
    metadata: {
        country?: string;
        device?: 'mobile' | 'desktop' | 'unknown';
        userAgent?: string;
    }
) {
    // Only track actual anonymous visitors here.
    if (!visitorId.startsWith("anon_")) {
        return;
    }

    try {
        const timestamp = Date.now();
        const visitorKey = `visitor:${visitorId}`;

        const existing = await kv.hgetall(visitorKey);
        const pipeline = kv.pipeline();

        // 1. Add to global visitors set
        pipeline.sadd("visitors", visitorId);

        // 2. Set static first-seen data only for new visitors
        if (!existing) {
            pipeline.hset(visitorKey, {
                firstSeen: timestamp,
                country: metadata.country || 'Unknown',
                device: metadata.device || 'unknown',
                userAgent: metadata.userAgent || ''
            });
        }

        // 3. Always update dynamic fields
        pipeline.hset(visitorKey, {
            lastSeen: timestamp,
            ...(metadata.country && { country: metadata.country }),
            ...(metadata.device && { device: metadata.device })
        });

        // 4. Increment query counter
        if (eventType === 'query') {
            pipeline.incr("queries:total");
            pipeline.hincrby(visitorKey, "queryCount", 1);
        }

        // 5. Update global device/country stats
        if (metadata.country) {
            pipeline.incr(`stats:country:${metadata.country}`);
        }
        if (metadata.device) {
            pipeline.incr(`stats:device:${metadata.device}`);
        }

        await pipeline.exec();
    } catch (error) {
        console.error("Failed to track analytics event:", error);
    }
}

export async function trackSelectionPerformance(params: {
    type: "index_hit" | "index_miss" | "llm_fallback";
    selectionMs: number;
}): Promise<void> {
    try {
        const dayKey = new Date().toISOString().slice(0, 10);
        const baseKey = `stats:selection:${dayKey}`;
        const ttlSeconds = 14 * 24 * 60 * 60;
        const duration = Math.max(0, Math.round(params.selectionMs));

        const pipeline = kv.pipeline();
        pipeline.incr(`${baseKey}:count`);
        pipeline.incrby(`${baseKey}:ms_total`, duration);
        pipeline.incr(`${baseKey}:${params.type}`);
        pipeline.expire(`${baseKey}:count`, ttlSeconds);
        pipeline.expire(`${baseKey}:ms_total`, ttlSeconds);
        pipeline.expire(`${baseKey}:${params.type}`, ttlSeconds);
        await pipeline.exec();
    } catch (error) {
        console.error("Failed to track selection performance:", error);
    }
}

/**
 * Track an authenticated user query event in Postgres.
 * Also handles migrating stats from an anonymous visitor ID if provided.
 */
export async function trackAuthenticatedQueryEvent(userId: string, anonId?: string): Promise<void> {
    try {
        // 1. Fetch user to check if admin
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { githubLogin: true }
        });

        if (isAdminActorUsername(user?.githubLogin)) {
            return;
        }

        // 2. Migration logic: if anonId provided, move its queryCount from KV to Postgres
        let migratedQueries = 0;
        if (anonId && anonId.startsWith("anon_")) {
            const visitorKey = `visitor:${anonId}`;
            const existing = await kv.hgetall(visitorKey) as any;

            if (existing && existing.queryCount) {
                migratedQueries = Number(existing.queryCount);

                // Atomic migration: decrement KV total and remove visitor record
                await Promise.all([
                    kv.srem("visitors", anonId),
                    kv.del(visitorKey),
                    kv.decrby("queries:total", migratedQueries)
                ]);
            }
        }

        // 3. Increment authenticated user stats in Postgres
        await prisma.user.upsert({
            where: { id: userId },
            update: {
                queryCount: { increment: migratedQueries + 1 },
                lastQueryAt: new Date(),
            },
            create: {
                id: userId,
                queryCount: migratedQueries + 1,
                lastQueryAt: new Date(),
            },
        });
    } catch (error) {
        console.error("Failed to track authenticated query event:", error);
    }
}

function bigIntToNumber(value: bigint | null | undefined): number | null {
    if (typeof value !== "bigint") return null;
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
}

async function getLoggedInUserStats(): Promise<LoggedInUserData[]> {
    try {
        type UserRow = Prisma.UserGetPayload<{
            select: {
                id: true;
                email: true;
                githubLogin: true;
                queryCount: true;
                createdAt: true;
                lastQueryAt: true;
            };
        }>;

        const [users, scanAgg, searchAgg, chatAgg] = await Promise.all([
            prisma.user.findMany({
                select: {
                    id: true,
                    email: true,
                    githubLogin: true,
                    queryCount: true,
                    createdAt: true,
                    lastQueryAt: true,
                },
                orderBy: [{ lastQueryAt: "desc" }, { createdAt: "desc" }],
                take: 200,
            }),
            prisma.repoScan.groupBy({
                by: ["userId"],
                where: { userId: { not: null } },
                _count: { _all: true },
                _max: { timestamp: true },
            }),
            prisma.recentSearch.groupBy({
                by: ["userId"],
                _count: { _all: true },
                _max: { timestamp: true },
            }),
            prisma.chatConversation.groupBy({
                by: ["userId"],
                _count: { _all: true },
                _max: { updatedAt: true },
            }),
        ]);

        const scanMap = new Map<string, { count: number; maxTimestamp: number | null }>();
        for (const row of scanAgg) {
            if (!row.userId) continue;
            scanMap.set(row.userId, {
                count: row._count._all,
                maxTimestamp: bigIntToNumber(row._max.timestamp),
            });
        }

        const searchMap = new Map<string, { count: number; maxTimestamp: number | null }>();
        for (const row of searchAgg) {
            searchMap.set(row.userId, {
                count: row._count._all,
                maxTimestamp: bigIntToNumber(row._max.timestamp),
            });
        }

        const chatMap = new Map<string, { count: number; maxTimestamp: number | null }>();
        for (const row of chatAgg) {
            chatMap.set(row.userId, {
                count: row._count._all,
                maxTimestamp: row._max.updatedAt ? row._max.updatedAt.getTime() : null,
            });
        }

        const rows = (users as UserRow[])
            .map((user): LoggedInUserData | null => {
                const scans = scanMap.get(user.id);
                const searches = searchMap.get(user.id);
                const chats = chatMap.get(user.id);
                const lastActivityAt = Math.max(
                    user.lastQueryAt?.getTime() ?? 0,
                    scans?.maxTimestamp ?? 0,
                    searches?.maxTimestamp ?? 0,
                    chats?.maxTimestamp ?? 0,
                );

                if (isAdminActorUsername(user.githubLogin)) {
                    return null;
                }

                return {
                    id: user.id,
                    email: user.email,
                    githubLogin: user.githubLogin,
                    queryCount: user.queryCount,
                    scanCount: scans?.count ?? 0,
                    searchCount: searches?.count ?? 0,
                    chatCount: chats?.count ?? 0,
                    createdAt: user.createdAt.getTime(),
                    lastActivityAt: lastActivityAt > 0 ? lastActivityAt : null,
                };
            })
            .filter((user): user is LoggedInUserData => (
                user !== null &&
                (
                    Boolean(user.email || user.githubLogin) ||
                    user.queryCount > 0 ||
                    user.scanCount > 0 ||
                    user.searchCount > 0 ||
                    user.chatCount > 0
                )
            ))
            .sort((a, b) => {
                const aLast = a.lastActivityAt ?? 0;
                const bLast = b.lastActivityAt ?? 0;
                if (aLast !== bLast) return bLast - aLast;
                return b.queryCount - a.queryCount;
            });

        return rows;
    } catch (error) {
        console.error("Failed to query logged-in user stats:", error);
        return [];
    }
}

function dayKeyFromDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function getRecentDayKeys(days: number): string[] {
    const keys: string[] = [];
    for (let i = 0; i < days; i += 1) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        keys.push(dayKeyFromDate(date));
    }
    return keys;
}

function emptyReportFunnelMetrics(): ReportFunnelMetrics {
    const zeroTotals = Object.fromEntries(
        REPORT_CONVERSION_EVENTS.map((event) => [event, 0])
    ) as Record<ReportConversionEvent, number>;

    return {
        totals: { ...zeroTotals },
        weekly: { ...zeroTotals },
        weeklyConversionRate: 0,
        weeklyFalsePositiveRate: 0,
        weeklyExpiredLinkFailures: 0,
    };
}

async function getReportFunnelMetrics(): Promise<ReportFunnelMetrics> {
    try {
        const totalsPipeline = kv.pipeline();
        REPORT_CONVERSION_EVENTS.forEach((event) => {
            totalsPipeline.get(`stats:report:${event}`);
        });
        const totalValues = await totalsPipeline.exec() as Array<number | string | null>;

        const totals = emptyReportFunnelMetrics().totals;
        REPORT_CONVERSION_EVENTS.forEach((event, index) => {
            totals[event] = Number(totalValues[index] || 0);
        });

        const dayKeys = getRecentDayKeys(7);
        const weeklyPipeline = kv.pipeline();
        for (const event of REPORT_CONVERSION_EVENTS) {
            for (const dayKey of dayKeys) {
                weeklyPipeline.get(`stats:report:${event}:${dayKey}`);
            }
        }

        const weeklyValues = await weeklyPipeline.exec() as Array<number | string | null>;
        const weekly = emptyReportFunnelMetrics().weekly;

        let cursor = 0;
        for (const event of REPORT_CONVERSION_EVENTS) {
            let totalForEvent = 0;
            for (let i = 0; i < dayKeys.length; i += 1) {
                totalForEvent += Number(weeklyValues[cursor] || 0);
                cursor += 1;
            }
            weekly[event] = totalForEvent;
        }

        const views = weekly.report_viewed_shared;
        const fixStarts = weekly.report_fix_chat_started;
        const falsePositiveFlags = weekly.report_false_positive_flagged;
        const expiredFailures = weekly.report_shared_link_invalid + weekly.report_expired_viewed;

        return {
            totals,
            weekly,
            weeklyConversionRate: views > 0 ? (fixStarts / views) * 100 : 0,
            weeklyFalsePositiveRate: views > 0 ? (falsePositiveFlags / views) * 100 : 0,
            weeklyExpiredLinkFailures: expiredFailures,
        };
    } catch (error) {
        console.error("Failed to aggregate report funnel metrics:", error);
        return emptyReportFunnelMetrics();
    }
}

function isAdminActorUsername(actorUsername?: string | null): boolean {
    const configuredAdmin = process.env.ADMIN_GITHUB_USERNAME?.trim();
    if (!configuredAdmin || !actorUsername) {
        return false;
    }

    return actorUsername === configuredAdmin;
}

export async function trackReportConversionEvent(
    event: ReportConversionEvent,
    scanId?: string,
    options?: ReportConversionTrackingOptions,
): Promise<void> {
    if (isAdminActorUsername(options?.actorUsername)) {
        return;
    }

    try {
        const dayKey = dayKeyFromDate(new Date());
        const pipeline = kv.pipeline();
        pipeline.incr(`stats:report:${event}`);
        pipeline.incr(`stats:report:${event}:${dayKey}`);

        if (scanId) {
            pipeline.incr(`stats:report:scan:${scanId}:${event}`);
        }

        await pipeline.exec();
    } catch (error) {
        console.error("Failed to track report conversion event:", error);
    }
}

export async function resetReportConversionMetrics(): Promise<void> {
    try {
        const keys = await kv.keys("stats:report:*");
        if (keys.length === 0) {
            return;
        }

        const pipeline = kv.pipeline();
        keys.forEach((key) => {
            pipeline.del(key);
        });
        await pipeline.exec();
    } catch (error) {
        console.error("Failed to reset report conversion metrics:", error);
        throw error;
    }
}

/**
 * Fetch aggregated analytics data for the dashboard
 */

async function getManualAnalyticsAdjustments(): Promise<{ visitors: number; queries: number }> {
    try {
        const [visitorsAdjustment, queriesAdjustment] = await Promise.all([
            kv.get<number>("stats:adjustment:visitors"),
            kv.get<number>("stats:adjustment:queries"),
        ]);

        return {
            visitors: Number(visitorsAdjustment || 0),
            queries: Number(queriesAdjustment || 0),
        };
    } catch (error) {
        console.error("Failed to fetch manual analytics adjustments:", error);
        return { visitors: 0, queries: 0 };
    }
}

function getDayKeyFromTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

async function getSelectionPerformance(window: SelectionPerformanceWindow): Promise<SelectionPerformanceMetrics> {
    try {
        const now = Date.now();
        const dayKeys = new Set<string>();

        if (window === "24h") {
            dayKeys.add(getDayKeyFromTimestamp(now));
            dayKeys.add(getDayKeyFromTimestamp(now - 24 * 60 * 60 * 1000));
        } else {
            for (let i = 0; i < 7; i += 1) {
                dayKeys.add(getDayKeyFromTimestamp(now - i * 24 * 60 * 60 * 1000));
            }
        }

        const keys = Array.from(dayKeys);
        const pipeline = kv.pipeline();
        keys.forEach((dayKey) => {
            const baseKey = `stats:selection:${dayKey}`;
            pipeline.get(`${baseKey}:count`);
            pipeline.get(`${baseKey}:ms_total`);
            pipeline.get(`${baseKey}:index_hit`);
            pipeline.get(`${baseKey}:llm_fallback`);
        });
        const values = await pipeline.exec() as Array<number | string | null>;

        let selections = 0;
        let msTotal = 0;
        let indexHits = 0;
        let fallbacks = 0;

        for (let i = 0; i < values.length; i += 4) {
            selections += Number(values[i] || 0);
            msTotal += Number(values[i + 1] || 0);
            indexHits += Number(values[i + 2] || 0);
            fallbacks += Number(values[i + 3] || 0);
        }

        const avgSelectionMs = selections > 0 ? Math.round(msTotal / selections) : 0;
        const indexHitRate = selections > 0 ? Number(((indexHits / selections) * 100).toFixed(1)) : 0;
        const fallbackRate = selections > 0 ? Number(((fallbacks / selections) * 100).toFixed(1)) : 0;

        return {
            avgSelectionMs,
            indexHitRate,
            fallbackRate,
            selections,
        };
    } catch (error) {
        console.error("Failed to fetch selection performance metrics:", error);
        return { avgSelectionMs: 0, indexHitRate: 0, fallbackRate: 0, selections: 0 };
    }
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
    try {
        // Parallelize fetching independent data
        const [
            totalVisitorsAggRaw,
            totalQueriesAggRaw,
            visitorIdsRaw,
            kvInfo,
            reportFunnel,
            falsePositiveReview,
            selection24h,
            selection7d,
        ] = await Promise.all([
            kv.scard("visitors"),
            kv.get<number>("queries:total"),
            kv.smembers("visitors"),
            getKVStats(),
            getReportFunnelMetrics().catch((error) => {
                console.error("Failed to fetch report funnel analytics:", error);
                return emptyReportFunnelMetrics();
            }),
            getFalsePositiveReviewSummary().catch((error) => {
                console.error("Failed to fetch false positive review data:", error);
                return {
                    total: 0,
                    pending: 0,
                    confirmedFalsePositive: 0,
                    rejected: 0,
                    recentSubmissions: [],
                };
            }),
            getSelectionPerformance("24h"),
            getSelectionPerformance("7d"),
        ]);

        const totalVisitorsAgg = Number(totalVisitorsAggRaw || 0);
        const totalQueriesAgg = Number(totalQueriesAggRaw || 0);
        const visitorIds = (visitorIdsRaw as string[]) || [];

        // Any ID in the 'visitors' KV set is considered an anonymous (or unmigrated historical) visitor.
        // Logged-in users who migrate are removed from this set.
        const totalAnonVisitors = visitorIds.length;
        const totalAnonQueries = totalQueriesAgg;

        // Fetch logged-in user summary stats
        const [loggedInUsers, manualAdjustments] = await Promise.all([
            getLoggedInUserStats().catch((error) => {
                console.error("Failed to fetch logged-in user analytics:", error);
                return [];
            }),
            getManualAnalyticsAdjustments(),
        ]);

        // Record usage and get history
        const kvHistory = await recordKVUsageHistory(kvInfo.currentSize);

        // Limit details fetch to the last 1000 visitors to avoid command explosion
        // In a real app with millions of users, we'd use pagination or a separate list for "recent"
        const MAX_VISITORS_TO_FETCH = 500;
        const sortedVisitorIds = visitorIds.slice(-MAX_VISITORS_TO_FETCH);

        const pipeline = kv.pipeline();
        sortedVisitorIds.forEach(id => pipeline.hgetall(`visitor:${id}`));
        const visitorsDetails = await pipeline.exec() as Array<Partial<VisitorData> | null>;

        // Process visitors for the recent activity table
        const recentVisitors: VisitorData[] = [];
        let activeUsers24h = 0;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

        visitorsDetails.forEach((details, index) => {
            if (!details) return;

            const visitor: VisitorData = {
                id: sortedVisitorIds[index],
                country: details.country ?? "Unknown",
                device: details.device ?? "unknown",
                lastSeen: Number(details.lastSeen),
                firstSeen: Number(details.firstSeen ?? details.lastSeen),
                queryCount: Number(details.queryCount ?? 0),
            };

            recentVisitors.push(visitor);

            if (visitor.lastSeen > oneDayAgo) {
                activeUsers24h++;
            }
        });

        // Fetch pre-aggregated stats for global accuracy (since recentVisitors is limited)
        const countryKeys = await kv.keys("stats:country:*");
        const deviceKeys = await kv.keys("stats:device:*");

        const statsPipeline = kv.pipeline();
        countryKeys.forEach((key) => statsPipeline.get(key));
        deviceKeys.forEach((key) => statsPipeline.get(key));
        const statsValues = await statsPipeline.exec() as Array<number | string | null>;

        const countryStats: Record<string, number> = {};
        const deviceStats: Record<string, number> = { mobile: 0, desktop: 0, unknown: 0 };

        countryKeys.forEach((key, i) => {
            const country = key.replace("stats:country:", "");
            countryStats[country] = Number(statsValues[i] || 0);
        });

        deviceKeys.forEach((key, i) => {
            const device = key.replace("stats:device:", "");
            deviceStats[device] = Number(statsValues[countryKeys.length + i] || 0);
        });

        // if we didn't fetch all visitors, our stats might be incomplete
        // but for a dashboard, showing stats for the most recent 500 is a fair trade-off
        // unless we transition to pre-aggregated keys (next step)

        const authQueryTotal = loggedInUsers.reduce((sum: number, u: LoggedInUserData) => sum + (u.queryCount || 0), 0);

        return {
            totalVisitors: totalAnonVisitors + manualAdjustments.visitors + loggedInUsers.length,
            totalQueries: (totalAnonQueries || 0) + manualAdjustments.queries + authQueryTotal,
            activeUsers24h,
            totalLoggedInUsers: loggedInUsers.length,
            deviceStats,
            countryStats,
            recentVisitors,
            loggedInUsers,
            kvStats: {
                currentSize: kvInfo.currentSize,
                maxSize: kvInfo.maxSize,
                history: kvHistory
            },
            searchPerformance: {
                byWindow: {
                    "24h": selection24h,
                    "7d": selection7d,
                },
            },
            reportFunnel,
            falsePositiveReview,
        };

    } catch (error) {
        console.error("Failed to fetch analytics data:", error);
        return {
            totalVisitors: 0,
            totalQueries: 0,
            activeUsers24h: 0,
            totalLoggedInUsers: 0,
            deviceStats: {},
            countryStats: {},
            recentVisitors: [],
            loggedInUsers: [],
            searchPerformance: {
                byWindow: {
                    "24h": { avgSelectionMs: 0, indexHitRate: 0, fallbackRate: 0, selections: 0 },
                    "7d": { avgSelectionMs: 0, indexHitRate: 0, fallbackRate: 0, selections: 0 },
                },
            },
            reportFunnel: emptyReportFunnelMetrics(),
            falsePositiveReview: {
                total: 0,
                pending: 0,
                confirmedFalsePositive: 0,
                rejected: 0,
                recentSubmissions: [],
            },
        };
    }
}

/**
 * Fetch lightweight, aggregated stats for public viewing (e.g. landing page).
 * Cache for 60 seconds to speed up landing page requests while staying fresh.
 */
const getCachedPublicStats = unstable_cache(
    async () => {
        try {
            const adminUsername = process.env.ADMIN_GITHUB_USERNAME?.trim();
            
            // 1. Fetch KV data
            const [kvVisitorIdsRaw, totalAnonQueriesRaw, manualAdjustments] = await Promise.all([
                kv.smembers("visitors"),
                kv.get<number>("queries:total"),
                getManualAnalyticsAdjustments(),
            ]);

            const visitorIds = (kvVisitorIdsRaw as string[]) || [];
            // Count all IDs in KV. These are exclusively anonymous visitors or unmigrated historical records.
            const totalAnonVisitors = visitorIds.length;
            const totalAnonQueries = Number(totalAnonQueriesRaw || 0);

            // 2. Fetch Postgres data (excluding admin)
            const [totalScans, loggedInUserCount, authQueryAgg] = await Promise.all([
                prisma.repoScan.count({
                    where: adminUsername ? {
                        OR: [
                            { userId: null },
                            { user: { githubLogin: { not: adminUsername } } },
                            { user: { githubLogin: null } }
                        ]
                    } : {}
                }),
                prisma.user.count({ 
                    where: adminUsername ? { 
                        OR: [
                            { githubLogin: { not: adminUsername } },
                            { githubLogin: null }
                        ]
                    } : {} 
                }),
                prisma.user.aggregate({
                    where: adminUsername ? { 
                        OR: [
                            { githubLogin: { not: adminUsername } },
                            { githubLogin: null }
                        ]
                    } : {},
                    _sum: { queryCount: true }
                })
            ]);

            const authQueryTotal = authQueryAgg._sum.queryCount || 0;

            const finalStats = {
                totalVisitors: totalAnonVisitors + manualAdjustments.visitors + loggedInUserCount,
                totalQueries: totalAnonQueries + manualAdjustments.queries + authQueryTotal,
                totalScans,
            };

            // Debug log for admin visibility (only in server console)
            console.log("[Analytics] Calculated public stats:", finalStats);

            return finalStats;
        } catch (error: unknown) {
            console.error("Failed to fetch public stats:", error);
            return {
                totalVisitors: 0,
                totalQueries: 0,
                totalScans: 0,
            };
        }
    },
    ["public-stats-v2"], // Bumped key to force refresh
    {
        revalidate: 60,
        tags: ["public-stats"],
    }
);

export async function getPublicStats() {
    return getCachedPublicStats();
}
