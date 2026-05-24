// Shared GitHub API helpers used by the route handlers.

export const GITHUB_API = 'https://api.github.com';

export function ghHeaders(authorization: string | null) {
  if (!authorization) {
    throw new GitHubError(401, 'Missing Authorization header');
  }
  return {
    Authorization: authorization,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'codalyzer',
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
  const message = err instanceof Error ? err.message : 'Unknown error';
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
