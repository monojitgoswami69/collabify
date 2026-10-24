// GitHub client — talks to /api/* (Next.js route handlers) and handles OAuth popup.

const GH_TOKEN_KEY = 'collabify-github-token';
const GH_USER_KEY = 'collabify-github-user';
const OAUTH_RESULT_KEY = 'collabify-github-oauth-result';

function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/api${normalized}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface OAuthPopupResult {
  type: 'github-oauth';
  token?: string;
  error?: string;
}

function isOAuthPopupResult(value: unknown): value is OAuthPopupResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.type === 'github-oauth';
}

// ─── Token Management ──────────────────────────────────────────────────

// localStorage access can throw (SecurityError in privacy-restricted
// contexts) — every accessor degrades to null/no-op instead of throwing.

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — session-only auth */
  }
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getStoredToken(): string | null {
  return safeGetItem(GH_TOKEN_KEY);
}

export function storeToken(token: string): void {
  safeSetItem(GH_TOKEN_KEY, token);
}

export function clearToken(): void {
  safeRemoveItem(GH_TOKEN_KEY);
  safeRemoveItem(GH_USER_KEY);
  safeRemoveItem(OAUTH_RESULT_KEY);
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export function getStoredUser(): GitHubUser | null {
  const raw = safeGetItem(GH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GitHubUser;
  } catch {
    return null;
  }
}

export function storeUser(user: GitHubUser): void {
  safeSetItem(GH_USER_KEY, JSON.stringify(user));
}

// ─── Auth Headers ──────────────────────────────────────────────────────

function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ─── OAuth Popup Flow ──────────────────────────────────────────────────

export function startOAuthPopup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const expectedOrigin = window.location.origin;
    const popupCloseGraceMs = 1500;

    safeRemoveItem(OAUTH_RESULT_KEY);

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      apiUrl('/auth/github'),
      'github-oauth',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
    );

    if (!popup) {
      reject(new Error('Popup was blocked. Please allow popups for this site.'));
      return;
    }

    let completed = false;
    let pollTimer: number | undefined;
    let popupClosedAt: number | null = null;

    const complete = (payload: OAuthPopupResult) => {
      if (completed) return;
      completed = true;
      cleanup();
      if (payload.error) reject(new Error(payload.error));
      else if (payload.token) resolve(payload.token);
      else reject(new Error('No token received from GitHub.'));
    };

    const completeFromStorage = (): boolean => {
      const raw = safeGetItem(OAUTH_RESULT_KEY);
      if (!raw) return false;
      try {
        const payload = JSON.parse(raw);
        safeRemoveItem(OAUTH_RESULT_KEY);
        if (!isOAuthPopupResult(payload)) return false;
        complete(payload);
        return true;
      } catch {
        safeRemoveItem(OAUTH_RESULT_KEY);
        return false;
      }
    };

    const cleanup = () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('storage', storageHandler);
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      window.clearTimeout(hardTimeout);
    };

    const handler = (event: MessageEvent) => {
      if (event.source !== popup && event.source !== null) return;
      if (event.origin !== expectedOrigin) return;
      if (!isOAuthPopupResult(event.data)) return;
      complete(event.data);
    };

    const storageHandler = (event: StorageEvent) => {
      if (event.key !== OAUTH_RESULT_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        safeRemoveItem(OAUTH_RESULT_KEY);
        if (!isOAuthPopupResult(payload)) return;
        complete(payload);
      } catch {
        safeRemoveItem(OAUTH_RESULT_KEY);
      }
    };

    // A popup stuck on a GitHub error page (never closed) used to leave
    // the sign-in promise pending forever with the button disabled.
    const hardTimeout = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      cleanup();
      reject(new Error('Sign-in timed out — please try again.'));
    }, 5 * 60_000);

    pollTimer = window.setInterval(() => {
      if (popup.closed) {
        if (popupClosedAt === null) {
          popupClosedAt = Date.now();
          return;
        }
        if (completeFromStorage()) return;
        if (Date.now() - popupClosedAt < popupCloseGraceMs) return;
        if (completed) return;
        completed = true;
        cleanup();
        reject(new Error('Authentication cancelled.'));
      }
    }, 500);

    window.addEventListener('message', handler);
    window.addEventListener('storage', storageHandler);
  });
}

// ─── User ──────────────────────────────────────────────────────────────

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  let lastError = 'Failed to fetch GitHub user.';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(apiUrl('/github/user'), { headers: authHeaders(token) });
    if (res.ok) return res.json();
    // 401 is deterministic (bad token) — fail fast. 403 is usually a rate
    // limit and 5xx a transient GitHub failure; one retry after a beat.
    const retriable = res.status === 403 || res.status >= 500;
    if (retriable && attempt < 2) {
      await delay(300);
      continue;
    }
    lastError =
      res.status === 401
        ? 'Your GitHub token is invalid or expired — please reconnect.'
        : 'Failed to fetch GitHub user.';
    break;
  }
  throw new Error(lastError);
}

// ─── Repos ─────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  default_branch: string;
  owner: { login: string; avatar_url: string };
}

export async function listRepos(
  token: string,
  page = 1,
  perPage = 100,
  sort: 'updated' | 'pushed' | 'full_name' = 'updated',
): Promise<GitHubRepo[]> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), sort });
  const res = await fetch(`${apiUrl('/github/repos')}?${params}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch repositories.');
  return res.json();
}

// ─── Contents ──────────────────────────────────────────────────────────

export interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
  download_url: string | null;
}

export async function getRepoContents(
  token: string,
  owner: string,
  repo: string,
  path = '',
): Promise<GitHubContent[]> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  // Encode path segments so '?', '#', '..' and spaces survive the round trip.
  const base = apiUrl(
    `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
  );
  const res = await fetch(`${base}?${params}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Failed to fetch contents for ${owner}/${repo}/${path}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [data];
  return data;
}

// ─── File content ──────────────────────────────────────────────────────

export async function fetchFileContent(
  downloadUrl: string,
  token?: string | null,
): Promise<string> {
  const params = new URLSearchParams({ url: downloadUrl });
  const res = await fetch(`${apiUrl('/github/file')}?${params}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch file content.');
  return res.text();
}

// ─── Repo tree ─────────────────────────────────────────────────────────

export interface RepoTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size: number;
  sha: string;
}

export interface RepoTree {
  tree: RepoTreeItem[];
  sha: string;
  truncated: boolean;
}

export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<RepoTree> {
  // %2F-encode the branch so slashed branch names (release/v1) survive the
  // single dynamic route segment and reach GitHub intact.
  const res = await fetch(
    apiUrl(
      `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}`,
    ),
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`Failed to fetch repo tree for ${owner}/${repo}`);
  return res.json();
}

export async function fetchRawContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token?: string | null,
): Promise<string> {
  const rawUrl = buildRawUrl(owner, repo, branch, path);
  const params = new URLSearchParams({ url: rawUrl });
  const res = await fetch(`${apiUrl('/github/file')}?${params}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch file content.');
  return res.text();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map(decodeThenEncode)
    .join('/');
}

// Pasted GitHub links arrive percent-encoded ("my%20file.md"); encodePath
// used to re-encode the '%' itself ("my%2520file.md") and 404. Decode first
// (tolerating already-decoded input), then encode exactly once.
function decodeThenEncode(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* malformed encoding — use the raw segment */
  }
  return encodeURIComponent(decoded);
}

function buildRawUrl(owner: string, repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodePath(path)}`;
}

// ─── Public URL parsing ────────────────────────────────────────────────

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  fileName: string;
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  // Strip query/fragment first — GitHub's own "Copy permalink" links carry
  // ?plain=1#L1-L5 which used to pollute the imported file name and path.
  const stripped = url.split(/[?#]/, 1)[0] ?? url;
  const blobRegex = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i;
  const blobMatch = stripped.match(blobRegex);
  if (blobMatch) {
    const filePath = blobMatch[4]!;
    return {
      owner: blobMatch[1]!,
      repo: blobMatch[2]!,
      branch: blobMatch[3]!,
      path: filePath,
      fileName: filePath.split('/').pop() || filePath,
    };
  }
  const rawRegex = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i;
  const rawMatch = stripped.match(rawRegex);
  if (rawMatch) {
    const filePath = rawMatch[4]!;
    return {
      owner: rawMatch[1]!,
      repo: rawMatch[2]!,
      branch: rawMatch[3]!,
      path: filePath,
      fileName: filePath.split('/').pop() || filePath,
    };
  }
  return null;
}

export async function fetchFromPublicUrl(
  url: string,
): Promise<{ fileName: string; content: string }> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error(
      'Invalid GitHub URL. Supported formats:\n• https://github.com/owner/repo/blob/branch/file\n• https://raw.githubusercontent.com/owner/repo/branch/file',
    );
  }
  const rawUrl = buildRawUrl(parsed.owner, parsed.repo, parsed.branch, parsed.path);
  const res = await fetch(rawUrl);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('File not found. Make sure the repository and file are public.');
    }
    throw new Error(`Failed to fetch file (${res.status}).`);
  }
  return { fileName: parsed.fileName, content: await res.text() };
}
