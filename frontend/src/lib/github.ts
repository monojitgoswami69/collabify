// Shared GitHub API helpers used by the route handlers.

export const GITHUB_API = 'https://api.github.com';

export function ghHeaders(authorization: string | null) {
  if (!authorization) {
    throw new GitHubError(401, 'Missing Authorization header');
  }
  return {
    Authorization: authorization,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'collabify',
  };
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof GitHubError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Never pass internal error text (fetch failures, stack snippets) to the
  // client — log it server-side and return a generic message.
  console.error('[github-proxy] unexpected error:', err);
  return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
