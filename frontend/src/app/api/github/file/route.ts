import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

// SECURITY: only allow downloads from GitHub's raw content + API hosts.
const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'codeload.github.com',
  'private-user-images.githubusercontent.com',
  'objects.githubusercontent.com',
]);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return new Response(JSON.stringify({ error: `Host not allowed: ${parsed.hostname}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const auth = req.headers.get('authorization');
    const headers: Record<string, string> = {
      'User-Agent': 'collabify',
    };
    if (auth) headers.Authorization = auth;

    const res = await fetch(parsed.toString(), { headers, redirect: 'follow' });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch file' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const text = await res.text();
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
