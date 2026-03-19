import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get('owner') || 'developer';
    const repo = searchParams.get('repo') || 'repository';
    const isProfile = searchParams.get('type') === 'profile';

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            backgroundColor: '#09090b',
            backgroundImage: 'radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%), radial-gradient(circle at 75px 75px, #27272a 2%, transparent 0%)',
            backgroundSize: '100px 100px',
            padding: '80px',
            fontFamily: 'sans-serif'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '20px',
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#000'
            }}>
              RM
            </div>
            <span style={{ fontSize: '32px', fontWeight: 600, color: '#a1a1aa' }}>RepoMind AI</span>
          </div>

          <div style={{
            fontSize: '72px',
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.1,
            marginBottom: '30px',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <span>{isProfile ? 'Developer Profile Analysis:' : 'Repository Architecture:'}</span>
            <span style={{ color: '#3b82f6', marginTop: '10px' }}>
              {isProfile ? owner : `${owner}/${repo}`}
            </span>
          </div>

          <div style={{ fontSize: '32px', color: '#a1a1aa', marginTop: 'auto', display: 'flex' }}>
            Agentic CAG • Architecture Flowcharts • Security Scans
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e: any) {
    return new Response(`Failed to generate the image`, {
      status: 500,
    });
  }
}
