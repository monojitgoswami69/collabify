import { NextRequest, NextResponse } from 'next/server';
import { GITHUB_API, ghHeaders, errorResponse } from '@/lib/github';
import { rateLimit } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map(encodeURIComponent)
    .join('/');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo } = await params;
    const auth = req.headers.get('authorization');
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || '';

    const encodedPath = encodePath(path);

    const ghUrl = encodedPath
      ? `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`
      : `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;

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

const MAX_COMMIT_BYTES = 4 * 1024 * 1024; // ~3 MiB file as base64

/** Commit a file to the caller's repository (create or update). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    if (!rateLimit(req, { name: 'github-commit', max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const { owner, repo } = await params;
    const auth = req.headers.get('authorization');
    const headers = ghHeaders(auth);

    const body = (await req.json()) as {
      path?: unknown;
      content?: unknown;
      message?: unknown;
      branch?: unknown;
      sha?: unknown;
    };
    if (typeof body.path !== 'string' || body.path.length === 0 || body.path.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    if (typeof body.content !== 'string' || body.content.length > MAX_COMMIT_BYTES) {
      return NextResponse.json({ error: 'Invalid or oversized content' }, { status: 400 });
    }
    if (typeof body.message !== 'string' || body.message.trim().length === 0 || body.message.length > 500) {
      return NextResponse.json({ error: 'Invalid commit message' }, { status: 400 });
    }
    if (typeof body.branch !== 'string' || body.branch.length === 0) {
      return NextResponse.json({ error: 'Missing branch' }, { status: 400 });
    }

    const encodedPath = encodePath(body.path);
    const putRes = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: body.message,
          content: body.content,
          branch: body.branch,
          ...(typeof body.sha === 'string' && body.sha ? { sha: body.sha } : {}),
        }),
      },
    );
    if (!putRes.ok) {
      return NextResponse.json({ error: 'Commit rejected by GitHub' }, { status: putRes.status });
    }
    const data = (await putRes.json()) as { content?: { sha?: string; html_url?: string } };
    return NextResponse.json({
      sha: data.content?.sha ?? '',
      htmlUrl: data.content?.html_url ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
