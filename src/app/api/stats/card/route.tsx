import { ImageResponse } from 'next/og';
import { kv } from "@vercel/kv";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const totalQueries = await kv.get<number>("queries:total");
        const count = totalQueries || 0;
        const formattedCount = count.toLocaleString();

        return new ImageResponse(
            (
                <div
                    style={{
                        height: '100%',
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#09090b', // zinc-950
                        backgroundImage: 'linear-gradient(to bottom right, #18181b, #000000)',
                        border: '1px solid #3f3f46', // zinc-700
                        borderRadius: '12px',
                        fontFamily: 'sans-serif',
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    {/* Background Glow */}
                    <div
                        style={{
                            position: 'absolute',
                            top: '-50%',
                            left: '-50%',
                            width: '200%',
                            height: '200%',
                            backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(147, 51, 234, 0.15), transparent 50%)', // purple-600
                            pointerEvents: 'none',
                        }}
                    />

                    {/* Content Container */}
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px',
                            zIndex: 10,
                        }}
                    >
                        {/* Label */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '16px',
                                color: '#a1a1aa', // zinc-400
                                fontWeight: 500,
                                letterSpacing: '0.05em',
                                textTransform: 'uppercase',
                            }}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#a855f7" // purple-500
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                            Total Queries Processed
                        </div>

                        {/* Number */}
                        <div
                            style={{
                                fontSize: '64px',
                                fontWeight: 800,
                                lineHeight: 1,
                                textShadow: '0 4px 20px rgba(168, 85, 247, 0.5)', // purple glow
                                backgroundImage: 'linear-gradient(to bottom, #ffffff, #e9d5ff)', // white to purple-100
                                backgroundClip: 'text',
                                color: 'transparent',
                            }}
                        >
                            {formattedCount}
                        </div>

                        {/* Footer */}
                        <div
                            style={{
                                marginTop: '12px',
                                fontSize: '12px',
                                color: '#52525b', // zinc-600
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}
                        >
                            <span>Powered by</span>
                            <span style={{ color: '#a855f7', fontWeight: 600 }}>RepoMind AI</span>
                        </div>
                    </div>
                </div>
            ),
            {
                width: 400,
                height: 200,
            }
        );
    } catch (error) {
        console.error("Failed to generate stats card:", error);
        return new Response("Failed to generate image", { status: 500 });
    }
}
