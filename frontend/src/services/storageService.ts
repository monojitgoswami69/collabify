import { FileNode, Theme } from '@/lib/types';

const KEYS = {
  FILES: 'codecollab-v2-files',
  ACTIVE_FILE: 'codecollab-v2-active-file',
  THEME: 'codecollab-v2-theme',
} as const;

export interface StoredFile extends FileNode {
  contentHash: string;
  lastModified: number;
  path?: string;
  repoOrigin?: {
    owner: string;
    repo: string;
    branch: string;
  };
  contentLoaded?: boolean;
}

export function computeContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
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
  localStorage.setItem(key, JSON.stringify(value));
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
  localStorage.setItem(KEYS.ACTIVE_FILE, fileId);
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
  localStorage.setItem(KEYS.THEME, theme);
}

export function clearAllStorage(): void {
  if (!isBrowser()) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
