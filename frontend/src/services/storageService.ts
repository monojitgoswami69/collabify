import { FileNode, Theme } from '@/lib/types';

const KEYS = {
  FILES: 'collabify-v2-files',
  ACTIVE_FILE: 'collabify-v2-active-file',
  THEME: 'collabify-v2-theme',
} as const;

export interface StoredFile extends FileNode {
  lastModified: number;
  path?: string;
  repoOrigin?: {
    owner: string;
    repo: string;
    branch: string;
  };
  contentLoaded?: boolean;
}

function isBrowser(): boolean {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  } catch {
    // Some sandboxed contexts make the localStorage getter itself throw.
    return false;
  }
}

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota exceeded or storage blocked — persistence degrades silently
    // rather than throwing from every debounced save.
    console.warn(`[storage] failed to persist "${key}":`, err);
  }
}

export function getStoredFiles(): StoredFile[] {
  return readJSON<StoredFile[]>(KEYS.FILES, []);
}

export function saveFiles(files: StoredFile[]): void {
  writeJSON(KEYS.FILES, files);
}

export function getActiveFileId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(KEYS.ACTIVE_FILE);
}

export function setActiveFileId(fileId: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEYS.ACTIVE_FILE, fileId);
  } catch {
    /* storage blocked — selection is session-only */
  }
}

export function getStoredTheme(): Theme {
  if (!isBrowser()) return 'dark';
  const stored = localStorage.getItem(KEYS.THEME);
  if (stored === 'light' || stored === 'dark') return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function setStoredTheme(theme: Theme): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEYS.THEME, theme);
  } catch {
    /* storage blocked — theme is session-only */
  }
}

