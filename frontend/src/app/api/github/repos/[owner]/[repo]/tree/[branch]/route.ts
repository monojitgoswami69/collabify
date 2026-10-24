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

    // Encode the ref — branches may contain '/' (e.g. release/v1) which must
    // arrive at GitHub as %2F, and unencoded '?'/'#'/'..' would rewrite the
    // upstream URL.
    const ghUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const res = await fetch(ghUrl, { headers: ghHeaders(auth) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch tree for ${owner}/${repo}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    type TreeEntry = { path: string; type: 'blob' | 'tree'; size?: number; sha: string };
    const rawTree = data.tree;
    if (!Array.isArray(rawTree)) {
      // Unexpected 200 body shape — fail as a bad gateway, not a 500 TypeError.
      return NextResponse.json(
        { error: 'Unexpected response from GitHub' },
        { status: 502 },
      );
    }
    const tree = (rawTree as TreeEntry[]).map((item) => ({
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
