import { NextRequest, NextResponse } from "next/server";
import { processProfileQueryStream } from "@/app/actions";
import { trackAuthenticatedQueryEvent, trackEvent } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { getInvalidSessionApiError, getSessionAuthState, getSessionUserId } from "@/lib/session-guard";
import type { StreamUpdate } from "@/lib/streaming-types";

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

async function requireAuthenticatedUser() {
    const session = await auth();
    const authState = getSessionAuthState(session);

    if (authState === "unauthenticated") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authState === "invalid") {
        return NextResponse.json(getInvalidSessionApiError(), { status: 401 });
    }
    if (!getSessionUserId(session)) {
        return NextResponse.json(getInvalidSessionApiError(), { status: 401 });
    }

    return session;
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    try {
        const session = await requireAuthenticatedUser();
        if (session instanceof NextResponse) {
            return session;
        }

        const userId = getSessionUserId(session);
        if (userId) {
            const userAgent = req.headers.get("user-agent") ?? "";
            const country = req.headers.get("x-vercel-ip-country") ?? "Unknown";
            const device = /mobile/i.test(userAgent) ? "mobile" : "desktop";
            await Promise.all([
                trackAuthenticatedQueryEvent(userId),
                trackEvent(userId, "query", { country, device, userAgent }),
            ]);
        }

        const body = await req.json();
        const { query, profileContext, modelPreference } = body;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const generator = processProfileQueryStream(query, profileContext, modelPreference);
                    for await (const chunk of generator) {
                        // Serialize chunk to JSON and add newline for framing
                        const data = JSON.stringify(chunk) + "\n";
                        controller.enqueue(encoder.encode(data));
                    }
                    controller.close();
                } catch (error: unknown) {
                    console.error("Stream generation error:", error);
                    const errorObj: StreamUpdate = {
                        type: "error",
                        message: getErrorMessage(error, "An error occurred during streaming."),
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
        console.error("API route error:", error);
        return new Response(
            JSON.stringify({ error: getErrorMessage(error, "An unexpected error occurred.") }),
            { status: 500 }
        );
    }
}
