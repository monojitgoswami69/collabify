'use client';

// Monaco model lifecycle helpers.
//
// Each file in the app maps to (potentially) two Monaco text models:
//   1. `inmemory:///<fileId>`           — the local-only editor
//   2. `inmemory:///collab/<fileId>`    — the y-monaco bound editor (when sharing)
//
// `@monaco-editor/react` creates a model the first time `<Editor path=…>` mounts
// and keeps it cached. When the underlying file is deleted from app state, the
// model survives — leaking its full text buffer + tokenization state.
//
// VSCode disposes models when the corresponding TextDocument closes. We do the
// same here, but lazily (on file-delete) AND defensively:
//   • Never dispose a model that's currently attached to a live editor — that
//     tears down the editor's InstantiationService and crashes the next render
//     with "InstantiationService has been disposed".
//   • Defer via queueMicrotask so React's pending state update (which swaps
//     the editor to the new active file) flushes BEFORE we try to dispose.

import * as monaco from 'monaco-editor';

function isModelInUse(model: monaco.editor.ITextModel): boolean {
  try {
    const modelUri = model.uri.toString();
    for (const ed of monaco.editor.getEditors()) {
      const m = ed.getModel();
      if (m && m.uri.toString() === modelUri) return true;
    }
  } catch {
    /* if iteration fails, treat as "in use" to be safe */
    return true;
  }
  return false;
}

function pathMatches(uriPath: string, fileId: string): boolean {
  // Exact match against the two URI shapes we create. No endsWith fuzz —
  // that was too loose and could touch unrelated models.
  return uriPath === `/${fileId}` || uriPath === `/collab/${fileId}`;
}

function safelyDispose(predicate: (uriPath: string) => boolean) {
  if (typeof window === 'undefined') return;
  try {
    const models = monaco.editor.getModels();
    for (const m of models) {
      if (!predicate(m.uri.path)) continue;
      if (isModelInUse(m)) continue; // attached to a live editor — leave alone
      try {
        m.dispose();
      } catch {
        /* model already disposed — fine */
      }
    }
  } catch {
    /* monaco not loaded yet — nothing to dispose */
  }
}

/**
 * Dispose every Monaco model whose URI matches a given fileId, across both
 * the local and collab path prefixes. Safe to call when monaco hasn't been
 * loaded yet (no-op), and safe to call while editors are still attached —
 * in-use models are skipped.
 *
 * Deferred via `queueMicrotask` so any pending React state update (e.g. the
 * editor swapping to a new active file after delete) commits first.
 */
export function disposeModelsForFile(fileId: string) {
  if (typeof window === 'undefined') return;
  queueMicrotask(() => {
    safelyDispose((path) => pathMatches(path, fileId));
  });
}

/**
 * Bulk variant — dispose models for a set of fileIds in one pass over
 * `getModels()`. Cheaper than calling `disposeModelsForFile` N times when
 * deleting a whole repo.
 */
export function disposeModelsForFiles(fileIds: Iterable<string>) {
  if (typeof window === 'undefined') return;
  const ids = new Set<string>();
  for (const id of fileIds) ids.add(id);
  if (ids.size === 0) return;
  queueMicrotask(() => {
    safelyDispose((path) => {
      // path is "/<id>" or "/collab/<id>" — strip the prefix and check.
      const tail = path.startsWith('/collab/') ? path.slice(8) : path.slice(1);
      return ids.has(tail);
    });
  });
}
