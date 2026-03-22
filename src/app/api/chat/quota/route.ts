import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAnonymousActorId } from "@/lib/actor-id";
import { getToolBudgetWindowUsage, type CacheAudience, type ToolBudgetScope } from "@/lib/cache";
import { getInvalidSessionApiError, getSessionAuthState, getSessionUserId } from "@/lib/session-guard";

function parseScope(value: string | null): ToolBudgetScope | null {
    if (value === "repo" || value === "profile") {
        return value;
    }
    return null;
}

export async function GET(req: NextRequest) {
    try {
        const scope = parseScope(req.nextUrl.searchParams.get("scope"));
        if (!scope) {
            return NextResponse.json({ error: "Invalid or missing scope. Use scope=repo|profile." }, { status: 400 });
        }

        const session = await auth();
        const authState = getSessionAuthState(session);
        if (authState === "invalid") {
            return NextResponse.json(getInvalidSessionApiError(), { status: 401 });
        }

        const userId = getSessionUserId(session);
        const audience: CacheAudience = userId ? "authenticated" : "anonymous";
        const actorId = userId ?? getAnonymousActorId(req.headers);
        const usage = await getToolBudgetWindowUsage(scope, audience, actorId);

        return NextResponse.json({
            scope,
            audience,
            ...usage,
            exhausted: usage.remaining <= 0,
        });
    } catch (error: unknown) {
        console.error("Quota API route error:", {
            path: req.nextUrl.pathname,
            error,
        });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
