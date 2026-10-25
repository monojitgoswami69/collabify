// Server-only SQLite store for accounts and workspace sync.
//
// Zero external dependencies — Node's built-in `node:sqlite`. The DB file
// lives under `data/` (gitignored) and its path is configurable via
// COLLABIFY_DB_PATH. WAL mode keeps concurrent route invocations healthy.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file =
    process.env.COLLABIFY_DB_PATH || path.join(process.cwd(), 'data', 'collabify.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      github_id  INTEGER PRIMARY KEY,
      login      TEXT NOT NULL,
      name       TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      github_id  INTEGER NOT NULL REFERENCES users(github_id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      user_id     INTEGER NOT NULL,
      file_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      language    TEXT NOT NULL DEFAULT '',
      path        TEXT,
      repo_origin TEXT,
      content_loaded INTEGER NOT NULL DEFAULT 1,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, file_id)
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      user_id    INTEGER NOT NULL,
      file_id    TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
  `);
  return db;
}

// ─── Users & sessions ───────────────────────────────────────────────────

export interface AccountUser {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export function upsertUser(user: AccountUser): void {
  getDb()
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
    )
    .run(user.githubId, user.login, user.name, user.avatarUrl, Date.now());
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(githubId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const tokenHash = createTokenHash(token);
  getDb()
    .prepare('INSERT INTO sessions (token_hash, github_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, githubId, expiresAt);
  return { token, expiresAt };
}

export function createTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Resolve a Bearer session token to its user. Returns null when invalid/expired. */
export function userForSession(token: string | null): AccountUser | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.github_id, u.login, u.name, u.avatar_url, s.expires_at
       FROM sessions s JOIN users u ON u.github_id = s.github_id
       WHERE s.token_hash = ?`,
    )
    .get(createTokenHash(token)) as
    | { github_id: number; login: string; name: string | null; avatar_url: string | null; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(createTokenHash(token));
    return null;
  }
  return {
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}

export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(createTokenHash(token));
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

// ─── Workspace files ────────────────────────────────────────────────────

export interface SyncFile {
  fileId: string;
  name: string;
  content: string;
  language: string;
  path?: string | null;
  repoOrigin?: { owner: string; repo: string; branch: string } | null;
  contentLoaded: boolean;
  updatedAt: number;
}

export function listFiles(userId: number): { files: SyncFile[]; tombstones: { fileId: string; deletedAt: number }[] } {
  const db = getDb();
  const files = (
    db.prepare('SELECT * FROM files WHERE user_id = ?').all(userId) as Record<string, unknown>[]
  ).map((r) => ({
    fileId: String(r.file_id),
    name: String(r.name),
    content: String(r.content),
    language: String(r.language),
    path: (r.path as string) || null,
    repoOrigin: r.repo_origin ? JSON.parse(String(r.repo_origin)) : null,
    contentLoaded: Number(r.content_loaded) === 1,
    updatedAt: Number(r.updated_at),
  }));
  const tombstones = (
    db.prepare('SELECT file_id, deleted_at FROM tombstones WHERE user_id = ?').all(userId) as Record<string, unknown>[]
  ).map((r) => ({ fileId: String(r.file_id), deletedAt: Number(r.deleted_at) }));
  return { files, tombstones };
}

export function upsertFiles(userId: number, files: SyncFile[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO files (user_id, file_id, name, content, language, path, repo_origin, content_loaded, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, file_id) DO UPDATE SET
       name = excluded.name, content = excluded.content, language = excluded.language,
       path = excluded.path, repo_origin = excluded.repo_origin,
       content_loaded = excluded.content_loaded, updated_at = excluded.updated_at`,
  );
  for (const f of files) {
    // Only accept a change if it is newer than what we already have (LWW).
    const existing = getDb()
      .prepare('SELECT updated_at FROM files WHERE user_id = ? AND file_id = ?')
      .get(userId, f.fileId) as { updated_at: number } | undefined;
    if (existing && existing.updated_at >= f.updatedAt) continue;
    stmt.run(
      userId,
      f.fileId,
      f.name.slice(0, 255),
      f.content ?? '',
      f.language ?? '',
      f.path ?? null,
      f.repoOrigin ? JSON.stringify(f.repoOrigin) : null,
      f.contentLoaded === false ? 0 : 1,
      Math.min(f.updatedAt, Date.now() + 60_000), // reject far-future clocks
    );
  }
}

export function tombstoneFiles(userId: number, fileIds: string[]): void {
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO tombstones (user_id, file_id, deleted_at) VALUES (?, ?, ?)',
  );
  const del = getDb().prepare('DELETE FROM files WHERE user_id = ? AND file_id = ?');
  for (const fileId of fileIds) {
    stmt.run(userId, fileId, Date.now());
    del.run(userId, fileId);
  }
}

export function purgeStaleSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
