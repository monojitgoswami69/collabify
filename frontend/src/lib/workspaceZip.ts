'use client';

// Workspace zip export/import (lazy JSZip).

import type { StoredFile } from '@/services/storageService';
import { newFileId } from '@/services/storageService';
import { detectLanguage } from '@/utils/detectLanguage';

export async function exportWorkspaceZip(files: StoredFile[]): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name || 'untitled';
    let n = 2;
    while (used.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
      n++;
    }
    used.add(name);
    zip.file(name, f.content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'collabify-workspace.zip';
  a.click();
  URL.revokeObjectURL(url);
}

const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'pyw', 'cpp', 'cc', 'cxx', 'hpp', 'c', 'h',
  'java', 'go', 'rs', 'rb', 'php', 'html', 'htm', 'css', 'scss', 'less', 'json', 'md', 'mdx',
  'yaml', 'yml', 'xml', 'svg', 'sh', 'bash', 'sql', 'txt', 'toml', 'ini', 'csv', 'swift', 'kt',
  'dart', 'lua', 'scala', 'vue', 'graphql', 'gitignore', 'env', 'dockerfile', 'makefile',
]);

function isTextEntry(name: string): boolean {
  if (!name.includes('.') || name.endsWith('/')) return true; // .gitignore etc.
  const ext = name.split('.').pop()!.toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/** Import a zip: returns one StoredFile per text entry (deduped names). */
export async function importWorkspaceZip(file: File, existingNames: string[]): Promise<StoredFile[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const out: StoredFile[] = [];
  const used = new Set(existingNames.map((n) => n.toLowerCase()));
  const entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.includes('__MACOSX'));
  for (const entry of entries.slice(0, 200)) {
    const baseName = entry.name.split('/').pop() || entry.name;
    if (!baseName || !isTextEntry(baseName)) continue;
    let name = baseName;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
      n++;
    }
    used.add(name.toLowerCase());
    const content = await entry.async('string');
    out.push({
      id: newFileId(),
      name,
      content,
      language: detectLanguage(name, content),
      lastModified: Date.now(),
      contentLoaded: true,
    });
    if (out.length >= 100) break;
  }
  return out;
}
