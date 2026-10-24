import { NextRequest } from 'next/server';
import { OAUTH_STATE_COOKIE } from '../route';

export const dynamic = 'force-dynamic';

// Safely embed a value as a JS literal inside an inline <script>. JSON.stringify
// produces a valid JS expression, but the HTML parser still terminates a
// <script> element on a literal "</", and JSON allows the unescaped
// U+2028 / U+2029 line terminators that break JS string literals.
function jsLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp('\\u2028','g'), '\\u2028')
    .replace(new RegExp('\\u2029','g'), '\\u2029');
}

function postMessageHtml(
  payload: { token?: string; error?: string },
  frontendOrigin: string,
) {
  const safePayload = jsLiteral({ type: 'github-oauth', ...payload });
  const safeOrigin = jsLiteral(frontendOrigin);

  return `<!DOCTYPE html>
<html>
<head><title>Authenticating…</title></head>
<body>
<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#888">
  Completing authentication…
</p>
<script>
  const payload = ${safePayload};
  try {
    localStorage.setItem("collabify-github-oauth-result", JSON.stringify(payload));
  } catch (_) {}
  const sendResult = () => {
    if (!window.opener) return;
    window.opener.postMessage(payload, ${safeOrigin});
  };
  if (window.opener) {
    sendResult();
    window.setTimeout(sendResult, 50);
    window.setTimeout(sendResult, 150);
  }
  window.setTimeout(() => window.close(), 300);
</script>
</body>
</html>`;
}

function htmlResponse(payload: { token?: string; error?: string }, frontendOrigin: string) {
  return new Response(postMessageHtml(payload, frontendOrigin), {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      // The body carries a live access token (or auth errors) — never cache.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  let frontendOrigin: string;
  try {
    frontendOrigin = new URL(appUrl).origin;
  } catch {
    frontendOrigin = 'http://localhost:3000';
  }

  if (error || !code) {
    return htmlResponse({ error: error || 'Authorization denied' }, frontendOrigin);
  }

  // CSRF check: the state GitHub echoes back must match the short-lived
  // httpOnly cookie set when the flow started. A mismatch (or a flow started
  // elsewhere) is a forged callback — reject without exchanging the code.
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return htmlResponse({ error: 'Invalid OAuth state — please retry sign-in.' }, frontendOrigin);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return htmlResponse({ error: 'GitHub OAuth credentials not configured' }, frontendOrigin);
  }

  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        // RFC 6749 §4.1.3 — resend the identical redirect_uri used at
        // authorization time.
        redirect_uri: `${appUrl}/api/auth/github/callback`,
      }),
    });

    if (!res.ok) {
      return htmlResponse({ error: 'Token exchange failed' }, frontendOrigin);
    }

    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    const accessToken = data.access_token;
    if (!accessToken) {
      const err = data.error_description || data.error || 'Unknown error';
      return htmlResponse({ error: err }, frontendOrigin);
    }

    return htmlResponse({ token: accessToken }, frontendOrigin);
  } catch {
    // Never leak internal fetch/infra error text into the page.
    return htmlResponse({ error: 'Unexpected error during sign-in' }, frontendOrigin);
  }
}
