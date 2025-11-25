import { kv } from "@vercel/kv";

export interface AnalyticsData {
    totalVisitors: number;
    totalQueries: number;
    activeUsers24h: number;
    deviceStats: Record<string, number>;
    countryStats: Record<string, number>;
    recentVisitors: VisitorData[];
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
        const pipeline = kv.pipeline();

        // 1. Add to global visitors set
        pipeline.sadd("visitors", visitorId);

        // 2. Update visitor metadata
        const visitorKey = `visitor:${visitorId}`;

        // Only set static data if not already present (to avoid overwriting firstSeen)
        const exists = await kv.exists(visitorKey);
        if (!exists) {
            pipeline.hset(visitorKey, {
                firstSeen: timestamp,
                country: metadata.country || 'Unknown',
                device: metadata.device || 'unknown',
                userAgent: metadata.userAgent || ''
            });
        }

        // Always update dynamic data
        pipeline.hset(visitorKey, {
            lastSeen: timestamp,
            // Update country/device if they changed (optional, but good for accuracy)
            ...(metadata.country && { country: metadata.country }),
            ...(metadata.device && { device: metadata.device })
        });

        // 3. Increment counters
        if (eventType === 'query') {
            pipeline.incr("queries:total");
            pipeline.hincrby(visitorKey, "queryCount", 1);
        }

        // 4. Update global stats
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
            visitorIds
        ] = await Promise.all([
            kv.scard("visitors"),
            kv.get<number>("queries:total"),
            kv.smembers("visitors")
        ]);

        // Fetch details for all visitors (limit to last 100 for performance if needed, but fetching all for now)
        // In a real app with millions of users, we'd use pagination or a separate list for "recent"
        // Fetch details for all visitors
        if (visitorIds.length === 0) {
            return {
                totalVisitors: 0,
                totalQueries: totalQueries || 0,
                activeUsers24h: 0,
                deviceStats: {},
                countryStats: {},
                recentVisitors: []
            };
        }

        const pipeline = kv.pipeline();
        visitorIds.forEach(id => pipeline.hgetall(`visitor:${id}`));
        const visitorsDetails = await pipeline.exec<VisitorData[]>();

        // Process visitors to build the report
        const recentVisitors: VisitorData[] = [];
        let activeUsers24h = 0;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

        // Re-calculate stats from visitor data to ensure consistency (or fetch from stats: keys)
        // Fetching from stats keys is faster but let's aggregate from visitor data for the table
        const deviceStats: Record<string, number> = { mobile: 0, desktop: 0, unknown: 0 };
        const countryStats: Record<string, number> = {};

        visitorsDetails.forEach((details, index) => {
            if (!details) return;

            const visitor = {
                ...details,
                id: visitorIds[index]
            };

            recentVisitors.push(visitor);

            // Active users
            if (visitor.lastSeen > oneDayAgo) {
                activeUsers24h++;
            }

            // Stats aggregation
            const device = visitor.device || 'unknown';
            deviceStats[device] = (deviceStats[device] || 0) + 1;

            const country = visitor.country || 'Unknown';
            countryStats[country] = (countryStats[country] || 0) + 1;
        });

        // Sort visitors by last seen (descending)
        recentVisitors.sort((a, b) => b.lastSeen - a.lastSeen);

        return {
            totalVisitors: totalVisitors || 0,
            totalQueries: totalQueries || 0,
            activeUsers24h,
            deviceStats,
            countryStats,
            recentVisitors
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
