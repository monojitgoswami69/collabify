import { NextRequest } from 'next/server';
import {
  bearerToken,
  userForSession,
  listFiles,
  upsertFiles,
  tombstoneFiles,
  purgeStaleSessions,
  type SyncFile,
} from '@/lib/server/store';
import { rateLimit } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Workspace sync API — authenticated by the opaque Collabify session token
// (issued by /api/auth/session). GET returns the full snapshot (files +
// tombstones); PUT upserts changed files with last-write-wins semantics;
// POST records deletions as tombstones so other devices converge.

const MAX_SYNC_BYTES = 8 * 1024 * 1024; // per-request payload guard

function auth(req: NextRequest) {
  const user = userForSession(bearerToken(req));
  if (!user) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const user = auth(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  purgeStaleSessions();
  return Response.json(listFiles(user.githubId), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(req: NextRequest) {
  if (!rateLimit(req, { name: 'workspace-put', max: 120, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }
  const user = auth(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { files?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.files) || body.files.length > 200) {
    return Response.json({ error: 'files must be an array of at most 200 entries' }, { status: 400 });
  }

  const clean: SyncFile[] = [];
  let bytes = 0;
  for (const raw of body.files) {
    if (!raw || typeof raw !== 'object') return Response.json({ error: 'Invalid file entry' }, { status: 400 });
    const f = raw as Partial<SyncFile> & { fileId?: unknown };
    if (typeof f.fileId !== 'string' || f.fileId.length === 0 || f.fileId.length > 64) {
      return Response.json({ error: 'Invalid fileId' }, { status: 400 });
    }
    if (typeof f.name !== 'string' || typeof f.content !== 'string') {
      return Response.json({ error: 'Invalid file entry' }, { status: 400 });
    }
    bytes += f.content.length;
    if (bytes > MAX_SYNC_BYTES) {
      return Response.json({ error: 'Sync payload too large' }, { status: 413 });
    }
    clean.push({
      fileId: f.fileId,
      name: f.name,
      content: f.content,
      language: typeof f.language === 'string' ? f.language : '',
      path: typeof f.path === 'string' ? f.path : null,
      repoOrigin:
        f.repoOrigin && typeof f.repoOrigin === 'object'
          ? {
              owner: String((f.repoOrigin as { owner?: unknown }).owner ?? ''),
              repo: String((f.repoOrigin as { repo?: unknown }).repo ?? ''),
              branch: String((f.repoOrigin as { branch?: unknown }).branch ?? ''),
            }
          : null,
      contentLoaded: f.contentLoaded !== false,
      updatedAt: typeof f.updatedAt === 'number' && Number.isFinite(f.updatedAt) ? f.updatedAt : Date.now(),
    });
  }

  upsertFiles(user.githubId, clean);
  return Response.json({ ok: true, synced: clean.length });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, { name: 'workspace-del', max: 120, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }
  const user = auth(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { fileIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.fileIds) || body.fileIds.length > 200) {
    return Response.json({ error: 'fileIds must be an array of at most 200 entries' }, { status: 400 });
  }
  const ids = body.fileIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64);
  tombstoneFiles(user.githubId, ids);
  return Response.json({ ok: true, deleted: ids.length });
}
