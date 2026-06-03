import { NextRequest, NextResponse } from 'next/server';
import { GITHUB_API, ghHeaders, errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo } = await params;
    const auth = req.headers.get('authorization');
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || '';

    const ghUrl = path
      ? `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`
      : `${GITHUB_API}/repos/${owner}/${repo}/contents`;

    const res = await fetch(ghUrl, { headers: ghHeaders(auth) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch contents for ${owner}/${repo}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
