import { NextRequest } from 'next/server';
import { upsertUser, createSession } from '@/lib/server/store';
import { rateLimit } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Exchange a GitHub access token (obtained via the existing OAuth popup flow)
// for a Collabify session. The GitHub token is verified against the GitHub
// API, the account is upserted, and an opaque session token (30 days) is
// issued — the SPA never uses the raw GitHub token for workspace sync.

export async function POST(req: NextRequest) {
  if (!rateLimit(req, { name: 'auth-session', max: 10, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { githubToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const githubToken = typeof body.githubToken === 'string' ? body.githubToken.trim() : '';
  if (!githubToken || githubToken.length > 256) {
    return Response.json({ error: 'Missing githubToken' }, { status: 400 });
  }

  let ghUser: { id?: number; login?: string; name?: string | null; avatar_url?: string | null };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'collabify',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return Response.json({ error: 'GitHub rejected that token' }, { status: 401 });
    }
    ghUser = await res.json();
  } catch {
    return Response.json({ error: 'Could not reach GitHub' }, { status: 502 });
  }

  if (typeof ghUser.id !== 'number' || typeof ghUser.login !== 'string') {
    return Response.json({ error: 'Unexpected GitHub response' }, { status: 502 });
  }

  upsertUser({
    githubId: ghUser.id,
    login: ghUser.login,
    name: ghUser.name ?? null,
    avatarUrl: ghUser.avatar_url ?? null,
  });
  const { token, expiresAt } = createSession(ghUser.id);

  return Response.json(
    {
      sessionToken: token,
      expiresAt,
      user: { login: ghUser.login, name: ghUser.name ?? null, avatarUrl: ghUser.avatar_url ?? null },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
