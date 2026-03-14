import { NextRequest, NextResponse } from "next/server";
import { processProfileQueryStream } from "@/app/actions";
import { trackAuthenticatedQueryEvent, trackEvent } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { consumeToolBudgetUsage, getToolBudgetUsage, type CacheAudience } from "@/lib/cache";
import { getAnonymousActorId } from "@/lib/actor-id";
import { getInvalidSessionApiError, getSessionAuthState, getSessionUserId } from "@/lib/session-guard";
import type { StreamUpdate } from "@/lib/streaming-types";

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return undefined;
    const maybeCode = (error as { code?: unknown }).code;
    return typeof maybeCode === "string" ? maybeCode : undefined;
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    try {
        const session = await auth();
        const authState = getSessionAuthState(session);
        if (authState === "invalid") {
            return NextResponse.json(getInvalidSessionApiError(), { status: 401 });
        }

        const userId = getSessionUserId(session);
        const audience: CacheAudience = userId ? "authenticated" : "anonymous";
        const actorId = userId ?? getAnonymousActorId(req.headers);

        const body = await req.json();
        const { query, profileContext, modelPreference, history, crossRepoEnabled } = body;

        if (modelPreference === "thinking" && !userId) {
            return NextResponse.json(
                {
                    error: "Login required for Thinking mode.",
                    code: "LOGIN_REQUIRED_THINKING_MODE",
                },
                { status: 401 }
            );
        }
        if (crossRepoEnabled && !userId) {
            return NextResponse.json(
                {
                    error: "Login required for cross-repo analysis.",
                    code: "LOGIN_REQUIRED_CROSS_REPO",
                },
                { status: 401 }
            );
        }

        const usage = await getToolBudgetUsage("profile", audience, actorId);
        if (usage.remaining <= 0) {
            if (audience === "anonymous") {
                return NextResponse.json(
                    {
                        error: "Anonymous tool usage limit reached for profile chat.",
                        code: "ANON_USAGE_LIMIT_EXCEEDED",
                    },
                    { status: 429 }
                );
            }
            return NextResponse.json(
                {
                    error: "Profile chat usage limit reached. Please contact pieisnot22by7@gmail.com.",
                    code: "AUTH_USAGE_LIMIT_EXCEEDED",
                },
                { status: 429 }
            );
        }

        if (userId) {
            const userAgent = req.headers.get("user-agent") ?? "";
            const country = req.headers.get("x-vercel-ip-country") ?? "Unknown";
            const device = /mobile/i.test(userAgent) ? "mobile" : "desktop";
            await Promise.all([
                trackAuthenticatedQueryEvent(userId),
                trackEvent(userId, "query", { country, device, userAgent }),
            ]);
        }

        const username = typeof profileContext?.username === "string" ? profileContext.username : undefined;
        const queryPreview = typeof query === "string" ? query.slice(0, 160) : undefined;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    let toolUnitsConsumed = 0;
                    const generator = processProfileQueryStream(query, profileContext, modelPreference, {
                        cacheAudience: audience,
                        cacheActorId: actorId,
                        crossRepoEnabled: Boolean(crossRepoEnabled),
                        history: Array.isArray(history) ? history : [],
                    });
                    for await (const chunk of generator) {
                        if (chunk.type === "tool") {
                            toolUnitsConsumed += Math.max(1, chunk.usageUnits ?? 1);
                        }
                        // Serialize chunk to JSON and add newline for framing
                        const data = JSON.stringify(chunk) + "\n";
                        controller.enqueue(encoder.encode(data));
                    }
                    if (toolUnitsConsumed > 0) {
                        await consumeToolBudgetUsage("profile", audience, actorId, toolUnitsConsumed);
                    }
                    controller.close();
                } catch (error: unknown) {
                    console.error("Profile chat stream generation error:", {
                        username,
                        queryPreview,
                        error,
                    });
                    const errorObj: StreamUpdate = {
                        type: "error",
                        message: getErrorMessage(error, "An error occurred during streaming."),
                        code: getErrorCode(error),
                    };
                    controller.enqueue(encoder.encode(JSON.stringify(errorObj) + "\n"));
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });
    } catch (error: unknown) {
        console.error("Profile chat API route error:", {
            path: req.nextUrl.pathname,
            error,
        });
        return new Response(
            JSON.stringify({ error: getErrorMessage(error, "An unexpected error occurred.") }),
            { status: 500 }
        );
    }
}
