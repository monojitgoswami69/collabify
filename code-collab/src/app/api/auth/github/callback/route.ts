import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function postMessageHtml(payload: { token?: string; error?: string }, frontendOrigin: string) {
  const parts: string[] = ['type: "github-oauth"'];
  if (payload.token) {
    const safe = payload.token.replace(/"/g, '\\"').replace(/\n/g, ' ');
    parts.push(`token: "${safe}"`);
  }
  if (payload.error) {
    const safe = payload.error.replace(/"/g, '\\"').replace(/\n/g, ' ');
    parts.push(`error: "${safe}"`);
  }
  const payloadJs = `{ ${parts.join(', ')} }`;

  return `<!DOCTYPE html>
<html>
<head><title>Authenticating…</title></head>
<body>
<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#888">
  Completing authentication…
</p>
<script>
  const payload = ${payloadJs};
  try {
    localStorage.setItem("codecollab-github-oauth-result", JSON.stringify(payload));
  } catch (_) {}
  const sendResult = () => {
    if (!window.opener) return;
    window.opener.postMessage(payload, "${frontendOrigin}");
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

    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
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
