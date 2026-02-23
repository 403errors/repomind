import { kv } from "@vercel/kv";

export interface KVUsagePoint {
    timestamp: number;
    size: number; // bytes
}

export interface AnalyticsData {
    totalVisitors: number;
    totalQueries: number;
    activeUsers24h: number;
    deviceStats: Record<string, number>;
    countryStats: Record<string, number>;
    recentVisitors: VisitorData[];
    kvStats?: {
        currentSize: number;
        maxSize: number;
        history: KVUsagePoint[];
    };
}

export interface VisitorData {
    id: string;
    country: string;
    device: string;
    lastSeen: number;
    queryCount: number;
    firstSeen: number;
}

/**
 * Fetch and parse KV info for storage stats
 */
async function getKVStats(): Promise<{ currentSize: number, maxSize: number }> {
    try {
        const info = await kv.exec(['INFO']) as string;

        // Parse "total_data_size" and "max_data_size"
        const totalSizeMatch = info.match(/total_data_size:(\d+)/);
        const maxSizeMatch = info.match(/max_data_size:(\d+)/);

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
        const lastPoints = await kv.lrange<KVUsagePoint>(HISTORY_KEY, 0, 0);
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
        const history = await kv.lrange<KVUsagePoint>(HISTORY_KEY, 0, MAX_HISTORY - 1);
        return history.reverse(); // Reverse so it's chronological for the graph
    } catch (error) {
        console.error("Failed to record KV history:", error);
        return [];
    }
}

/**
 * Track a user event (e.g., query)
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
    try {
        const timestamp = Date.now();
        const visitorKey = `visitor:${visitorId}`;

        // Check if visitor exists and run all updates in a single pipeline.
        // Using hgetall to detect a new visitor avoids a separate kv.exists
        // round-trip before the pipeline (which previously added ~1 sequential RTT).
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
        // Don't throw, analytics shouldn't break the app
    }
}

/**
 * Fetch aggregated analytics data for the dashboard
 */
export async function getAnalyticsData(): Promise<AnalyticsData> {
    try {
        // Parallelize fetching independent data
        const [
            totalVisitors,
            totalQueries,
            visitorIds,
            kvInfo
        ] = await Promise.all([
            kv.scard("visitors"),
            kv.get<number>("queries:total"),
            kv.smembers("visitors"),
            getKVStats()
        ]);

        // Record usage and get history
        const kvHistory = await recordKVUsageHistory(kvInfo.currentSize);

        // Limit details fetch to the last 1000 visitors to avoid command explosion
        // In a real app with millions of users, we'd use pagination or a separate list for "recent"
        const MAX_VISITORS_TO_FETCH = 500;
        const sortedVisitorIds = visitorIds.slice(-MAX_VISITORS_TO_FETCH);

        const pipeline = kv.pipeline();
        sortedVisitorIds.forEach(id => pipeline.hgetall(`visitor:${id}`));
        const visitorsDetails = await pipeline.exec<VisitorData[]>();

        // Process visitors for the recent activity table
        const recentVisitors: VisitorData[] = [];
        let activeUsers24h = 0;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

        visitorsDetails.forEach((details, index) => {
            if (!details) return;

            const visitor = {
                ...details,
                id: sortedVisitorIds[index],
                lastSeen: Number(details.lastSeen),
                firstSeen: Number(details.firstSeen || details.lastSeen),
                queryCount: Number(details.queryCount || 0)
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
        countryKeys.forEach(k => statsPipeline.get<number>(k));
        deviceKeys.forEach(k => statsPipeline.get<number>(k));
        const statsValues = await statsPipeline.exec<number[]>();

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

        // Sort visitors by last seen (descending)
        recentVisitors.sort((a, b) => b.lastSeen - a.lastSeen);

        return {
            totalVisitors: totalVisitors || 0,
            totalQueries: totalQueries || 0,
            activeUsers24h,
            deviceStats,
            countryStats,
            recentVisitors,
            kvStats: {
                currentSize: kvInfo.currentSize,
                maxSize: kvInfo.maxSize,
                history: kvHistory
            }
        };

    } catch (error) {
        console.error("Failed to fetch analytics data:", error);
        return {
            totalVisitors: 0,
            totalQueries: 0,
            activeUsers24h: 0,
            deviceStats: {},
            countryStats: {},
            recentVisitors: []
        };
    }
}

/**
 * Fetch lightweight, aggregated stats for public viewing (e.g. landing page)
 * Uses Next.js unstable_cache to cache the results globally
 */
import { unstable_cache } from 'next/cache';

export const getPublicStats = unstable_cache(
    async () => {
        try {
            const [totalVisitors, totalQueries] = await Promise.all([
                kv.scard("visitors"),
                kv.get<number>("queries:total")
            ]);

            return {
                totalVisitors: totalVisitors || 0,
                totalQueries: totalQueries || 0
            };
        } catch (error) {
            console.error("Failed to fetch public stats:", error);
            return {
                totalVisitors: 0,
                totalQueries: 0
            };
        }
    },
    ['public-stats'],
    {
        revalidate: 600, // Revalidate every 10 minutes
        tags: ['stats']
    }
);
