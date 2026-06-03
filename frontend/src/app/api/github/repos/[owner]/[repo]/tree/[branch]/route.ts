import { NextRequest, NextResponse } from 'next/server';
import { GITHUB_API, ghHeaders, errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const { owner, repo, branch } = await params;
    const auth = req.headers.get('authorization');

    const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetch(url, { headers: ghHeaders(auth) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch tree for ${owner}/${repo}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    type TreeEntry = { path: string; type: 'blob' | 'tree'; size?: number; sha: string };
    const tree = (data.tree as TreeEntry[]).map((item) => ({
      path: item.path,
      type: item.type,
      size: item.size ?? 0,
      sha: item.sha,
    }));
    return NextResponse.json({ tree, sha: data.sha, truncated: data.truncated ?? false });
  } catch (err) {
    return errorResponse(err);
  }
}
