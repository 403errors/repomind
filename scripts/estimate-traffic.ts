// Traffic estimation — uses the production Neon + Upstash credentials directly
// Run from project root: npx tsx scripts/estimate-traffic.ts

// Load .env.local so DATABASE_URL / KV vars are in scope
import { config } from "dotenv";
config({ path: ".env.local" });

// Must happen AFTER dotenv so the DATABASE_URL is set
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// Bug window: commit 2600639 landed Mar 18 00:00 IST = Mar 17 18:30 UTC
const SINCE = new Date("2026-03-17T18:30:00.000Z");
const ADMIN = process.env.ADMIN_GITHUB_USERNAME ?? "403errors";

async function main() {
    console.log("=== Traffic Estimate: Mar 18 – Mar 23 (5-day window) ===\n");

    // ── 1. AUTH USERS (Postgres) — trackAuthenticatedQueryEvent WAS working ──
    const activeUsers = await prisma.user.findMany({
        where: {
            lastQueryAt: { gte: SINCE },
            NOT: { githubLogin: ADMIN },
        },
        select: {
            githubLogin: true,
            email: true,
            queryCount: true,
            createdAt: true,
            lastQueryAt: true,
        },
        orderBy: { lastQueryAt: "desc" },
    });
    const newUsers = activeUsers.filter(u => u.createdAt >= SINCE);

    // ── 2. CHAT RUNS (Postgres) — introduced same commit, exact message count ──
    let authRuns = 0, anonRuns = 0;
    try {
        const runs: any[] = await prisma.$queryRaw`
            SELECT
                COUNT(*) FILTER (WHERE "userId" IS NOT NULL)::int AS auth_runs,
                COUNT(*) FILTER (WHERE "userId" IS NULL)::int     AS anon_runs
            FROM "ChatRun"
            WHERE "createdAt" >= ${SINCE}
        `;
        authRuns = Number(runs[0]?.auth_runs ?? 0);
        anonRuns = Number(runs[0]?.anon_runs ?? 0);
    } catch (e) { console.log("ChatRun query failed:", e); }

    // ── 3. REPO SCANS (Postgres) ──
    const recentScans: any[] = await prisma.$queryRaw`
        SELECT
            COUNT(*)                                      AS total,
            COUNT(*) FILTER (WHERE "userId" IS NULL)      AS anon,
            COUNT(*) FILTER (WHERE "userId" IS NOT NULL)  AS auth
        FROM "RepoScan"
        WHERE "timestamp" >= ${BigInt(SINCE.getTime())}
    `;
    const totalScans = Number(recentScans[0]?.total ?? 0);
    const anonScans  = Number(recentScans[0]?.anon ?? 0);
    const authScans  = Number(recentScans[0]?.auth ?? 0);

    // ── 4. KV (Upstash) — anonymous visitor & query data ──
    const { kv } = await import("@vercel/kv");
    const [anonQueryTotal, allVisitorIds, countryKeys, deviceKeys] = await Promise.all([
        kv.get<number>("queries:total"),
        kv.smembers("visitors"),
        kv.keys("stats:country:*"),
        kv.keys("stats:device:*"),
    ]);

    const anonIds = (allVisitorIds as string[]).filter(id => id.startsWith("anon_"));

    // Sample up to 300 to estimate what fraction are active since Mar 18
    const sampleIds = anonIds.slice(0, 300);
    const pipe = kv.pipeline();
    sampleIds.forEach(id => pipe.hgetall(`visitor:${id}`));
    const sampleData = await pipe.exec() as any[];
    const recentInSample = sampleData.filter(v => v && Number(v.lastSeen) >= SINCE.getTime());
    const fraction = sampleData.length > 0 ? recentInSample.length / sampleData.length : 0;
    const estAnonVisitors = Math.round(anonIds.length * fraction);

    // Country/device breakdown
    const statsPipe = kv.pipeline();
    [...countryKeys, ...deviceKeys].forEach(k => statsPipe.get(k));
    const statsVals = await statsPipe.exec() as any[];
    const countryStats: Record<string,number> = {};
    const deviceStats:  Record<string,number> = {};
    (countryKeys as string[]).forEach((k,i) => { countryStats[k.replace("stats:country:","")] = Number(statsVals[i]||0); });
    (deviceKeys  as string[]).forEach((k,i) => { deviceStats[k.replace("stats:device:","")] = Number(statsVals[countryKeys.length+i]||0); });

    // ── PRINT ──────────────────────────────────────────────────────────────
    console.log("━━━ AUTHENTICATED USERS (exact — Postgres) ━━━━━━━━━━━━━━");
    console.log(`  Active users (5-day window)        : ${activeUsers.length}`);
    console.log(`  New signups in window              : ${newUsers.length}`);
    console.log();
    console.log("  Top users:");
    activeUsers.slice(0, 20).forEach(u => {
        const name = (u.githubLogin || u.email || "?").padEnd(34);
        console.log(`    ${name}  ${String(u.queryCount).padStart(5)} queries  last: ${u.lastQueryAt?.toISOString().slice(0,16)}`);
    });
    if (activeUsers.length > 20) console.log(`    ... +${activeUsers.length - 20} more`);
    console.log();

    console.log("━━━ CHAT MESSAGES sent (ChatRun, exact) ━━━━━━━━━━━━━━━━");
    console.log(`  Total chat messages sent           : ${authRuns + anonRuns}`);
    console.log(`    └ authenticated                  : ${authRuns}`);
    console.log(`    └ anonymous                      : ${anonRuns}`);
    console.log();

    console.log("━━━ REPO SCANS (Postgres, exact) ━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Total scans                        : ${totalScans}`);
    console.log(`    └ authenticated                  : ${authScans}`);
    console.log(`    └ anonymous                      : ${anonScans}`);
    console.log();

    console.log("━━━ ANONYMOUS VISITORS (KV sampling) ━━━━━━━━━━━━━━━━━━");
    console.log(`  Total anon IDs in KV set           : ${anonIds.length}`);
    console.log(`  Sampled                            : ${sampleData.length}`);
    console.log(`  Active since Mar 18 in sample      : ${recentInSample.length}  (${(fraction*100).toFixed(0)}%)`);
    console.log(`  → Estimated new anon visitors      : ~${estAnonVisitors}`);
    console.log(`  KV queries:total (anon queries)    : ${anonQueryTotal ?? 0}  [cumulative, not just 5 days]`);
    console.log();

    console.log("━━━ COUNTRY BREAKDOWN (all-time KV) ━━━━━━━━━━━━━━━━━━━");
    Object.entries(countryStats).sort(([,a],[,b])=>b-a).forEach(([c,n]) => {
        console.log(`  ${c.padEnd(26)} ${n}`);
    });
    console.log();

    console.log("━━━ DEVICE BREAKDOWN (all-time KV) ━━━━━━━━━━━━━━━━━━━━");
    Object.entries(deviceStats).forEach(([d,n]) => console.log(`  ${d.padEnd(26)} ${n}`));
    console.log();

    const totalVisitors = activeUsers.length + estAnonVisitors;
    const totalQueries  = (authRuns + anonRuns) || (activeUsers.reduce((s,u)=>s+u.queryCount,0) + (anonQueryTotal ?? 0));

    console.log("━━━ ✅ SUMMARY ESTIMATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Authenticated visitors             : ${activeUsers.length}            [EXACT]`);
    console.log(`  Anonymous visitors                 : ~${estAnonVisitors}           [ESTIMATE]`);
    console.log(`  ═══════════════════════════════════════════════════════`);
    console.log(`  TOTAL VISITORS                     : ~${totalVisitors}`);
    console.log();
    console.log(`  Chat messages (auth)               : ${authRuns}         [EXACT]`);
    console.log(`  Chat messages (anon)               : ${anonRuns}         [EXACT]`);
    console.log(`  ═══════════════════════════════════════════════════════`);
    console.log(`  TOTAL CHAT QUERIES                 : ~${authRuns + anonRuns}`);
    console.log();
    console.log(`  Repo scans (all sources)           : ${totalScans}            [EXACT]`);

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
