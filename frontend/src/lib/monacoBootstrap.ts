'use client';

// Monaco loader bootstrap — runs once on the client.
//
// Bug it fixes: in the old Vite app, monaco was loaded via `loader.config({ paths: { vs: <cdn> }})`.
// AMD's `require` would race with React's first render, and if the CDN was slow or got cached
// stale, the editor would silently hang ("blank loader") until a hard refresh.
//
// Fix: feed the @monaco-editor/react loader the *already-bundled* monaco module from npm.
// No network fetch, no AMD race, no CDN dependency. The loader resolves synchronously
// the first time `<Editor>` mounts.

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { defineCatppuccinThemes } from './monacoThemes';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker;
    };
  }
}

let configured = false;
let initPromise: Promise<unknown> | null = null;

function setupWorkers() {
  if (typeof window === 'undefined') return;
  if (window.MonacoEnvironment) return;

  window.MonacoEnvironment = {
    getWorker(_workerId, label) {
      // Bundler-resolved worker URLs (Turbopack & Webpack 5 both support this pattern).
      if (label === 'json') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' },
      );
    },
  };
}

export function configureMonacoOnce(): Promise<unknown> {
  if (initPromise) return initPromise;
  if (configured) return Promise.resolve();
  configured = true;
  setupWorkers();
  loader.config({ monaco });
  // Register Catppuccin themes synchronously on the same monaco namespace
  // the loader is about to hand out — so the very first editor instance
  // sees `catppuccin-mocha`/`catppuccin-latte` already defined and never
  // paints the default vs-dark `#1e1e1e` bg.
  try {
    defineCatppuccinThemes(monaco);
  } catch (err) {
    console.error('[monaco] defineCatppuccinThemes failed', err);
  }
  initPromise = loader.init().then((m) => {
    // Belt-and-braces: in case the loader returned a different namespace.
    try { defineCatppuccinThemes(m); } catch {}
    return m;
  }).catch((err) => {
    console.error('[monaco] loader.init failed', err);
    configured = false;
    initPromise = null;
  });
  return initPromise;
}
