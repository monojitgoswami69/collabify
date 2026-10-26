// Client-side executor for the AI agent's workspace tools.
//
// The agent loop runs in the browser (useAgent) because the workspace state
// (files) lives here. Every tool the model calls — including web_search and
// run_python, which are executed via dedicated one-shot calls to
// /api/ai/chat — lands in `executeAgentTool` below.
//
// All tool arguments are treated as untrusted model output: ids are looked up
// (never trusted from context alone), line windows are clamped, patches must
// match exactly once, and content size is capped — the same posture as every
// other untrusted input boundary in this app.

import type { StoredFile } from '@/services/storageService';
import { newFileId } from '@/services/storageService';
import { detectLanguage } from '@/utils/detectLanguage';
import type { CollabProvider } from '@/services/collabService';

export const MAX_AGENT_FILE_BYTES = 1024 * 1024; // 1 MiB — mirrors the collab share cap
export const READ_WINDOW_LINES = 500;
const READ_MAX_LINE_CHARS = 400;

export interface AgentWorkspaceContext {
  files: StoredFile[];
  activeFileId: string | null;
  /** Live collab state, for patching shared docs while connected. */
  provider: CollabProvider | null;
  collabConnected: boolean;
  sharedFileIds: Set<string>;
  /** Applies a content change through the app's normal code-change path. */
  applyContent: (fileId: string, content: string) => void;
  /** Adds a file to workspace state; returns its id. */
  addFile: (file: StoredFile) => void;
  /** Removes a file through the app's delete path (unshares, disposes models). */
  removeFile: (fileId: string) => void;
  setActive: (fileId: string) => void;
}

export type ToolResult = Record<string, unknown>;

// ─── Workspace tools ────────────────────────────────────────────────────

function listFiles(ws: AgentWorkspaceContext): ToolResult {
  const files = ws.files.slice(0, 100).map((f) => ({
    id: f.id,
    name: f.name,
    language: f.language || 'auto',
    lines: f.content ? f.content.split('\n').length : 0,
    bytes: f.content.length,
    loaded: f.contentLoaded !== false,
    active: f.id === ws.activeFileId,
    ...(f.repoOrigin ? { repo: `${f.repoOrigin.owner}/${f.repoOrigin.repo}` } : {}),
  }));
  return { ok: true, count: ws.files.length, truncated: ws.files.length > 100, files };
}

function readFile(ws: AgentWorkspaceContext, args: { fileId?: unknown; startLine?: unknown; endLine?: unknown }): ToolResult {
  const file = ws.files.find((f) => f.id === args.fileId);
  if (!file) return { ok: false, error: 'No file with that id — call list_files for valid ids.' };
  if (file.contentLoaded === false) {
    return {
      ok: false,
      error:
        'This file is a repository import whose content is not loaded yet. Ask the user to click the file in the sidebar (which fetches it), then retry.',
    };
  }
  const lines = file.content.split('\n');
  const total = lines.length;
  const start = Math.min(Math.max(Number(args.startLine) || 1, 1), Math.max(total, 1));
  const requestedEnd = Number(args.endLine) || start + READ_WINDOW_LINES - 1;
  const end = Math.min(Math.max(requestedEnd, start), start + READ_WINDOW_LINES - 1, total);

  const formatted = lines
    .slice(start - 1, end)
    .map((line, i) => {
      const n = String(start + i).padStart(4, ' ');
      return `${n}| ${line.length > READ_MAX_LINE_CHARS ? `${line.slice(0, READ_MAX_LINE_CHARS)}…[line truncated]` : line}`;
    })
    .join('\n');

  const hasMore = end < total;
  return {
    ok: true,
    file: file.name,
    fileId: file.id,
    totalLines: total,
    returnedRange: `${start}-${end}`,
    content: formatted,
    ...(hasMore
      ? { nextStartLine: end + 1, note: `Call read_file with startLine=${end + 1} to continue reading.` }
      : { note: 'Reached end of file.' }),
  };
}

function createFile(ws: AgentWorkspaceContext, args: { name?: unknown; content?: unknown }): ToolResult {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!name || name.includes('/')) {
    return { ok: false, error: 'A plain file name is required (no path separators).' };
  }
  if (content.length > MAX_AGENT_FILE_BYTES) {
    return { ok: false, error: `Content exceeds the ${MAX_AGENT_FILE_BYTES} byte limit.` };
  }
  if (ws.files.some((f) => f.name === name)) {
    return { ok: false, error: `A file named "${name}" already exists — edit it instead.` };
  }
  const file: StoredFile = {
    id: newFileId(),
    name,
    content,
    language: detectLanguage(name, content),
    lastModified: Date.now(),
    contentLoaded: true,
  };
  ws.addFile(file);
  if (!ws.activeFileId) ws.setActive(file.id);
  return { ok: true, fileId: file.id, name, lines: content.split('\n').length };
}

/**
 * Apply ordered unique-match find/replace patches to a file — the only way
 * the agent modifies existing content (patch-based, never a full rewrite).
 * An empty `find` appends `replace` at the end. All-or-nothing per call:
 * if any patch fails, NOTHING is applied and the error names the failing edit.
 */
/** Before/after preview for the approval card (never mutates state). */
export function previewPatch(
  content: string,
  edits: { find: string; replace: string }[],
): { before: string; after: string } | null {
  const patch = computePatch(content, edits);
  return patch.ok ? { before: content, after: patch.content } : null;
}

function computePatch(
  content: string,
  edits: { find: string; replace: string }[],
): { ok: true; content: string; applied: number } | { ok: false; error: string } {
  let out = content;
  for (let i = 0; i < edits.length; i++) {
    const { find, replace } = edits[i];
    if (find === '') {
      // Append (needs a separator unless the file is empty or ends with one).
      out = out.length === 0 || out.endsWith('\n') ? out + replace : `${out}\n${replace}`;
      continue;
    }
    const idx = out.indexOf(find);
    if (idx === -1) {
      return { ok: false, error: `Edit ${i + 1}: find-text not found. Re-read the file region and match the content exactly.` };
    }
    if (out.indexOf(find, idx + 1) !== -1) {
      return { ok: false, error: `Edit ${i + 1}: find-text matches MULTIPLE locations. Include more surrounding lines to make it unique.` };
    }
    out = out.slice(0, idx) + replace + out.slice(idx + find.length);
  }
  return { ok: true, content: out, applied: edits.length };
}

/** Apply the same patches to the live Yjs doc so room members see the change. */
function patchSharedDoc(
  ws: AgentWorkspaceContext,
  fileId: string,
  edits: { find: string; replace: string }[],
): { patched: boolean; note?: string } {
  const { provider } = ws;
  if (!provider || !ws.collabConnected || !ws.sharedFileIds.has(fileId)) return { patched: false };
  const existed = provider.docConnections.has(fileId);
  try {
    const conn = provider.openFileConnection(fileId);
    const ytext = conn.doc.getText('monaco');
    let text = ytext.toString();
    for (const { find, replace } of edits) {
      if (find === '') {
        const at = text.length;
        ytext.insert(at, text.endsWith('\n') || at === 0 ? replace : `\n${replace}`);
        text = ytext.toString();
        continue;
      }
      const idx = text.indexOf(find);
      if (idx === -1 || text.indexOf(find, idx + 1) !== -1) {
        return {
          patched: existed,
          note: 'Shared document diverged from the local copy — only the local file was updated. Re-share the file to sync members.',
        };
      }
      ytext.delete(idx, find.length);
      ytext.insert(idx, replace);
      text = ytext.toString();
    }
    if (!existed) provider.closeFileConnection(fileId);
    return { patched: true };
  } catch {
    return { patched: false, note: 'Failed to patch the shared document — only the local file was updated.' };
  }
}

function editFile(
  ws: AgentWorkspaceContext,
  args: { fileId?: unknown; edits?: unknown },
): ToolResult {
  const file = ws.files.find((f) => f.id === args.fileId);
  if (!file) return { ok: false, error: 'No file with that id — call list_files for valid ids.' };
  if (file.contentLoaded === false) {
    return { ok: false, error: 'File content is not loaded yet — ask the user to open the file first.' };
  }
  if (!Array.isArray(args.edits) || args.edits.length === 0) {
    return { ok: false, error: 'edits must be a non-empty array of {find, replace}.' };
  }
  if (args.edits.length > 20) {
    return { ok: false, error: 'Too many edits in one call (max 20) — split into multiple calls.' };
  }
  const edits = args.edits.map((e) => ({
    find: typeof (e as { find?: unknown })?.find === 'string' ? (e as { find: string }).find : '',
    replace: typeof (e as { replace?: unknown })?.replace === 'string' ? (e as { replace: string }).replace : '',
  }));
  // Reject edits whose replacement would blow the size cap.
  const delta = edits.reduce((n, e) => n + e.replace.length - e.find.length, 0);
  if (file.content.length + delta > MAX_AGENT_FILE_BYTES) {
    return { ok: false, error: `Patched file would exceed the ${MAX_AGENT_FILE_BYTES} byte limit.` };
  }

  const patch = computePatch(file.content, edits);
  if (!patch.ok) return { ok: false, fileId: file.id, file: file.name, error: patch.error };

  const shared = patchSharedDoc(ws, file.id, edits);
  ws.applyContent(file.id, patch.content);

  return {
    ok: true,
    fileId: file.id,
    file: file.name,
    applied: patch.applied,
    totalLinesAfter: patch.content.split('\n').length,
    ...(shared.patched ? { sharedDocUpdated: true } : {}),
    ...(shared.note ? { note: shared.note } : {}),
  };
}

function deleteFile(ws: AgentWorkspaceContext, args: { fileId?: unknown }): ToolResult {
  const file = ws.files.find((f) => f.id === args.fileId);
  if (!file) return { ok: false, error: 'No file with that id — call list_files for valid ids.' };
  ws.removeFile(file.id);
  return { ok: true, fileId: file.id, deleted: file.name };
}

// ─── Dispatch ───────────────────────────────────────────────────────────

export const MUTATING_TOOLS = new Set(['create_file', 'edit_file', 'delete_file']);
export const KNOWN_TOOLS = new Set([
  'list_files',
  'read_file',
  'create_file',
  'edit_file',
  'delete_file',
  'web_search',
  'run_python',
]);

export function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ws: AgentWorkspaceContext,
): ToolResult {
  switch (name) {
    case 'list_files':
      return listFiles(ws);
    case 'read_file':
      return readFile(ws, args);
    case 'create_file':
      return createFile(ws, args);
    case 'edit_file':
      return editFile(ws, args);
    case 'delete_file':
      return deleteFile(ws, args);
    default:
      return { ok: false, error: `Unknown tool "${name}".` };
  }
}

// ─── Workspace context summary (injected into every agent request) ─────

export function buildWorkspaceContext(ws: AgentWorkspaceContext): string {
  const lines: string[] = [];
  const files = ws.files.slice(0, 50);
  for (const f of files) {
    lines.push(
      `- ${f.name} [id=${f.id}] lang=${f.language || 'auto'} lines=${f.content ? f.content.split('\n').length : 0}` +
        `${f.id === ws.activeFileId ? ' (ACTIVE)' : ''}${f.contentLoaded === false ? ' (content not loaded)' : ''}` +
        `${ws.sharedFileIds.has(f.id) ? ' (shared in room)' : ''}`,
    );
  }
  if (ws.files.length > files.length) lines.push(`- …and ${ws.files.length - files.length} more files`);
  return lines.join('\n');
}
