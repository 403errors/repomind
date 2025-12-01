import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
    // Get the origin of the request
    const origin = request.headers.get('origin');

    // Define allowed origins
    const allowedOrigins = [
        'https://repomind-ai.vercel.app',
        'http://localhost:3000',
        'http://localhost:3001',
    ];

    // Check if origin is allowed
    const isAllowedOrigin = origin && allowedOrigins.includes(origin);

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
        return new NextResponse(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': isAllowedOrigin ? origin : allowedOrigins[0],
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    // Handle actual requests
    const response = NextResponse.next();

    if (isAllowedOrigin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    return response;
}

// Configure which routes use this middleware
export const config = {
    matcher: '/api/:path*',
};
