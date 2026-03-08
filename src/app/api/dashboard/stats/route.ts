import { auth } from "@/lib/auth";
import { getUserScans } from "@/lib/services/scan-storage";
import { NextResponse } from "next/server";

export async function GET() {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const scans = await getUserScans(session.user.id);

        const reposScanned = new Set<string>();
        let issuesFound = 0;
        let deepScans = 0;

        for (const scan of scans) {
            reposScanned.add(`${scan.owner}/${scan.repo}`);
            issuesFound += scan.summary.total || 0;
            if (scan.depth === 'deep') {
                deepScans += 1;
            }
        }

        return NextResponse.json({
            stats: {
                reposScanned: reposScanned.size,
                issuesFound,
                deepScans
            }
        });
    } catch {
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }
}
