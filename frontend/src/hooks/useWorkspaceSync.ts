'use client';

// Workspace sync engine — keeps the browser workspace in step with the
// server store for the signed-in account.
//
// Strategy (v1, last-write-wins per file):
//   * Pull on sign-in: server snapshot merges with local state (newer
//     updatedAt wins; local-only files are kept and pushed; server-only
//     files are added; tombstoned ids are removed locally).
//   * Push: the existing debounced save computes dirty files
//     (lastModified newer than the last synced version) and PUTs them.
//   * Deletions are recorded as tombstones so other devices converge.
// No realtime cross-device sync yet — a second device converges on load.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredFile } from '@/services/storageService';
import type { Account } from '@/hooks/useAccount';

interface SyncOptions {
  account: Account;
  /** Live files — re-arms the debounced push on every change. */
  files: StoredFile[];
  filesRef: React.RefObject<StoredFile[]>;
  hydratedFilesRef: React.RefObject<StoredFile[] | null>;
  setFiles: (files: StoredFile[]) => void;
  isInitialized: boolean;
}

interface SyncFileWire {
  fileId: string;
  name: string;
  content: string;
  language: string;
  path?: string | null;
  repoOrigin?: { owner: string; repo: string; branch: string } | null;
  contentLoaded: boolean;
  updatedAt: number;
}

export function useWorkspaceSync({ account, files, filesRef, hydratedFilesRef, setFiles, isInitialized }: SyncOptions) {
  const { signOut } = account;
  const lastSyncedRef = useRef<Map<string, number>>(new Map());
  const pendingTombstonesRef = useRef<Set<string>>(new Set());
  const syncingRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const user = account.user;
  const getSessionToken = account.getSessionToken;

  const authHeaders = useCallback((): Record<string, string> | null => {
    const token = getSessionToken();
    if (!token) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }, [getSessionToken]);

  /** Pull the server snapshot and merge it into local state. */
  const pullAndMerge = useCallback(async (): Promise<void> => {
    const headers = authHeaders();
    if (!headers || syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setLastSyncError(null);
    try {
      const res = await fetch('/api/workspace', { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401) {
        signOut();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        files: SyncFileWire[];
        tombstones: { fileId: string; deletedAt: number }[];
      };
      const tombstoned = new Set(data.tombstones.map((t) => t.fileId));
      const serverById = new Map(data.files.map((f) => [f.fileId, f]));

      const local = filesRef.current ?? [];
      const merged: StoredFile[] = [];
      for (const f of local) {
        if (tombstoned.has(f.id)) continue; // deleted on another device
        const s = serverById.get(f.id);
        if (!s) {
          merged.push(f); // local-only — will be pushed
          continue;
        }
        serverById.delete(f.id);
        if (s.updatedAt > f.lastModified) {
          // Server copy is newer (edited elsewhere) — take it.
          merged.push({
            ...f,
            name: s.name,
            content: s.content,
            language: s.language,
            path: s.path ?? f.path,
            repoOrigin: s.repoOrigin ?? f.repoOrigin,
            contentLoaded: s.contentLoaded,
            lastModified: s.updatedAt,
          });
        } else {
          merged.push(f); // local is newer or equal — will be pushed
        }
      }
      // Server-only files — add locally.
      for (const s of serverById.values()) {
        merged.push({
          id: s.fileId,
          name: s.name,
          content: s.content,
          language: s.language,
          path: s.path ?? undefined,
          repoOrigin: s.repoOrigin ?? undefined,
          contentLoaded: s.contentLoaded,
          lastModified: s.updatedAt,
          // StoredFile requires contentHash in older shape? (removed in audit) — no.
        });
      }

      setFiles(merged);
      hydratedFilesRef.current = merged; // new baseline for the corrupt-save guard
      lastSyncedRef.current = new Map(merged.map((f) => [f.id, f.lastModified]));
      // Push local-only/newer files right away so the server converges.
      await pushDirty(merged);
    } catch {
      setLastSyncError('Offline — will retry');
      /* offline — local workspace keeps working; retried on next change */
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signOut, authHeaders, filesRef, hydratedFilesRef, setFiles]);

  /** Push files whose lastModified is newer than the last synced version. */
  const pushDirty = useCallback(
    async (files?: StoredFile[]): Promise<void> => {
      const headers = authHeaders();
      if (!headers) return;
      const current = files ?? filesRef.current ?? [];
      const dirty = current.filter(
        (f) => !pendingTombstonesRef.current.has(f.id) && (lastSyncedRef.current.get(f.id) ?? -1) < f.lastModified,
      );
      if (dirty.length === 0) return;
      try {
        const res = await fetch('/api/workspace', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            files: dirty.map((f) => ({
              fileId: f.id,
              name: f.name,
              content: f.content,
              language: f.language,
              path: f.path ?? null,
              repoOrigin: f.repoOrigin ?? null,
              contentLoaded: f.contentLoaded !== false,
              updatedAt: f.lastModified,
            })),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 401) {
          signOut();
          return;
        }
        if (res.ok) {
          for (const f of dirty) lastSyncedRef.current.set(f.id, f.lastModified);
        }
        // On failure: lastSyncedRef untouched → retried on the next change.
      } catch {
        /* offline — retried on next change */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signOut, authHeaders, filesRef],
  );

  /** Record deletions server-side as tombstones. */
  const markDeleted = useCallback(
    (fileIds: string[]): void => {
      if (fileIds.length === 0) return;
      for (const id of fileIds) {
        lastSyncedRef.current.delete(id);
        pendingTombstonesRef.current.add(id);
      }
      const headers = authHeaders();
      if (!headers) return;
      void fetch('/api/workspace', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileIds }),
        signal: AbortSignal.timeout(15_000),
      })
        .then((res) => {
          if (res.ok) {
            for (const id of fileIds) pendingTombstonesRef.current.delete(id);
          }
        })
        .catch(() => {
          /* retried via markDeleted on next occurrence */
        });
    },
    [authHeaders],
  );

  // Pull once when a signed-in account meets an initialized workspace.
  useEffect(() => {
    if (user && isInitialized) void pullAndMerge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isInitialized]);

  // Debounced push after local changes (runs alongside the localStorage save).
  useEffect(() => {
    if (!user || !isInitialized) return;
    const t = setTimeout(() => void pushDirty(), 1500);
    return () => clearTimeout(t);
  }, [user, isInitialized, files, pushDirty]);

  return { pullAndMerge, pushDirty, markDeleted, isSyncing, lastSyncError };
}

export type WorkspaceSync = ReturnType<typeof useWorkspaceSync>;
