import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/github';

export const dynamic = 'force-dynamic';

// SECURITY: only allow downloads from GitHub's raw content + API hosts. Every
// redirect hop is re-validated against this set (see fetchValidated below), so
// an off-host Location header cannot turn this route into an open proxy.
const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'codeload.github.com',
  'private-user-images.githubusercontent.com',
  'objects.githubusercontent.com',
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB — this proxy serves source files
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

function isAllowed(target: URL): boolean {
  return (
    target.protocol === 'https:' && // no plaintext first hop to GitHub hosts
    target.port === '' && // default ports only — no port probing of GitHub infra
    ALLOWED_HOSTS.has(target.hostname)
  );
}

/**
 * Follow redirects manually, validating scheme/host/port of EVERY hop against
 * the allowlist. `redirect: 'follow'` would blindly follow a Location header
 * anywhere the first host sends it.
 */
async function fetchValidated(
  start: URL,
  headers: Record<string, string>,
): Promise<Response> {
  let target: URL = start;
  // One overall deadline for the whole chain — per-hop timeouts previously
  // allowed up to ~6x15s of upstream time for a single request.
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Upstream fetch timed out');
    const res = await fetch(target.toString(), {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(remaining),
    });
    // opaqueredirect only happens with mode:'no-cors'; treat 3xx manually:
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res; // let the caller surface the odd 3xx
      const next = new URL(location, target);
      if (!isAllowed(next)) {
        throw new HostNotAllowedError(next.hostname);
      }
      target = next;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

class HostNotAllowedError extends Error {
  hostname: string;
  constructor(hostname: string) {
    super(`Redirect host not allowed: ${hostname}`);
    this.hostname = hostname;
  }
}

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

    if (!isAllowed(parsed)) {
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

    const res = await fetchValidated(parsed, headers);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch file' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Bounded read: stream up to MAX_FILE_BYTES, then cancel — an unbounded
    // res.text() let a single codeload tarball URL exhaust server memory.
    const reader = res.body?.getReader();
    if (!reader) {
      return new Response(JSON.stringify({ error: 'Empty upstream response' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    let tooLarge = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_FILE_BYTES) {
        tooLarge = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    if (tooLarge) {
      return new Response(JSON.stringify({ error: 'File exceeds the 5 MiB proxy limit' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    if (err instanceof HostNotAllowedError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return errorResponse(err);
  }
}
