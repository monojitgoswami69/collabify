import { NextRequest, NextResponse } from 'next/server';
import { GITHUB_API, ghHeaders, errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    const url = new URL(req.url);
    const page = url.searchParams.get('page') || '1';
    const perPage = url.searchParams.get('per_page') || '100';
    const sort = url.searchParams.get('sort') || 'updated';

    const params = new URLSearchParams({
      per_page: perPage,
      page,
      sort,
      affiliation: 'owner,collaborator,organization_member',
    });

    const res = await fetch(`${GITHUB_API}/user/repos?${params}`, { headers: ghHeaders(auth) });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch repos' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
