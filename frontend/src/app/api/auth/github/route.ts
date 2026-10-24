import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const OAUTH_STATE_COOKIE = 'collabify_oauth_state';
const STATE_MAX_AGE_SECONDS = 600;

export function GET(_req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GITHUB_CLIENT_ID not configured' }, { status: 500 });
  }

  const scopes = process.env.GITHUB_OAUTH_SCOPES || 'repo read:org read:user';
  const appUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  // CSRF protection (RFC 6749 §10.12): opaque single-use state bound to this
  // browser via a short-lived httpOnly cookie and verified in the callback.
  const state = randomBytes(16).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  const res = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
    maxAge: STATE_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
