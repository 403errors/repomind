import { NextRequest, NextResponse } from 'next/server';
import { fixMermaidSyntax } from '@/lib/gemini';

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export async function POST(req: NextRequest) {
    try {
        const { code } = await req.json();

        if (!code) {
            return NextResponse.json(
                { error: 'Missing code parameter' },
                { status: 400 }
            );
        }

        const fixed = await fixMermaidSyntax(code);

        if (!fixed) {
            return NextResponse.json(
                { error: 'Failed to fix Mermaid syntax' },
                { status: 500 }
            );
        }

        return NextResponse.json({ fixed });
    } catch (error: unknown) {
        console.error('Error fixing Mermaid syntax:', error);
        return NextResponse.json(
            { error: getErrorMessage(error, 'Internal server error') },
            { status: 500 }
        );
    }
}
