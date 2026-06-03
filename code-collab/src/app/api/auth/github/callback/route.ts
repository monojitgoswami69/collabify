import { NextRequest } from 'next/server';

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
    localStorage.setItem("codecollab-github-oauth-result", JSON.stringify(payload));
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const appUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const frontendOrigin = new URL(appUrl).origin;

  if (error || !code) {
    return new Response(
      postMessageHtml({ error: error || 'Authorization denied' }, frontendOrigin),
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(
      postMessageHtml({ error: 'GitHub OAuth credentials not configured' }, frontendOrigin),
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
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
      }),
    });

    if (!res.ok) {
      return new Response(
        postMessageHtml({ error: 'Token exchange failed' }, frontendOrigin),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    const accessToken = data.access_token;
    if (!accessToken) {
      const err = data.error_description || data.error || 'Unknown error';
      return new Response(postMessageHtml({ error: err }, frontendOrigin), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response(postMessageHtml({ token: accessToken }, frontendOrigin), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (e) {
    return new Response(
      postMessageHtml({ error: (e as Error).message || 'Unexpected error' }, frontendOrigin),
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }
}
