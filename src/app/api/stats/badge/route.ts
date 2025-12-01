import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const totalQueries = await kv.get<number>("queries:total");
        const count = totalQueries || 0;

        // Format for Shields.io Endpoint
        // https://shields.io/badges/endpoint-badge
        return NextResponse.json({
            schemaVersion: 1,
            label: "Total Queries",
            message: count.toLocaleString(),
            color: "blue",
            cacheSeconds: 60 // Cache for 1 minute
        });
    } catch (error) {
        console.error("Failed to fetch query stats:", error);
        return NextResponse.json({
            schemaVersion: 1,
            label: "Total Queries",
            message: "error",
            color: "red"
        });
    }
}
