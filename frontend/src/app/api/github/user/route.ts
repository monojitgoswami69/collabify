import { NextRequest, NextResponse } from 'next/server';
import { GITHUB_API, ghHeaders, errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    const res = await fetch(`${GITHUB_API}/user`, { headers: ghHeaders(auth) });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch GitHub user' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({
      login: data.login,
      avatar_url: data.avatar_url,
      name: data.name ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
