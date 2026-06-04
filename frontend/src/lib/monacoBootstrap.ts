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
//
// This module also configures language-service defaults globally — once, on
// the singleton monaco namespace — so every editor instance inherits the same
// diagnostics behavior without re-running setDiagnosticsOptions per mount.
//
// Note on monaco-editor 0.55 API: language defaults moved from
// `monaco.languages.typescript.*` to top-level `monaco.typescript.*`,
// `monaco.css.*`, `monaco.html.*`, `monaco.json.*`. The old paths are
// deprecated stubs in the type definitions.

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

// Loose typing for the language-service namespaces — monaco's d.ts exposes
// these via internal symbols that don't surface ergonomically through the
// public ESM root. The shape is stable; we lean on runtime guards instead.
type MonacoNs = typeof monaco & {
  typescript?: {
    ScriptTarget: typeof monaco.languages.typescript extends never
      ? never
      : Record<string, number>;
    ModuleKind: Record<string, number>;
    ModuleResolutionKind: Record<string, number>;
    JsxEmit: Record<string, number>;
    typescriptDefaults: LanguageServiceDefaults;
    javascriptDefaults: LanguageServiceDefaults;
    getTypeScriptWorker?: () => Promise<unknown>;
    getJavaScriptWorker?: () => Promise<unknown>;
  };
  css?: {
    cssDefaults: { setOptions: (o: unknown) => void };
    scssDefaults: { setOptions: (o: unknown) => void };
    lessDefaults: { setOptions: (o: unknown) => void };
  };
  html?: {
    htmlDefaults: { setOptions: (o: unknown) => void };
  };
  json?: {
    jsonDefaults: { setDiagnosticsOptions: (o: unknown) => void };
  };
};

interface LanguageServiceDefaults {
  setCompilerOptions: (opts: unknown) => void;
  setDiagnosticsOptions: (opts: unknown) => void;
  setEagerModelSync?: (eager: boolean) => void;
  setInlayHintsOptions?: (opts: unknown) => void;
}

// HMR survival: Turbopack hot-reloads any 'use client' module that imports
// something which changed. Without a global guard, `configured`/`initPromise`
// reset to false on every module re-eval, and we'd call `loader.config`
// (which tries to re-attach a different monaco namespace) + re-run language
// defaults against a half-disposed instance — that's how you get
// "InstantiationService has been disposed" on the next editor mount.
//
// Stash the flags on globalThis so they survive HMR cycles.
interface MonacoBootstrapGlobal {
  __collabify_monaco_configured?: boolean;
  __collabify_monaco_initPromise?: Promise<unknown> | null;
}
const g = globalThis as unknown as MonacoBootstrapGlobal;

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

/**
 * Configure language-service defaults (TS, JS, JSON, CSS, HTML) ONCE on the
 * shared monaco namespace. This matches the pattern used in VSCode and large
 * Monaco-based products (StackBlitz, CodeSandbox, GitHub.dev) — defaults live
 * at the language-registry level, not per-editor.
 *
 * Diagnostics are fully enabled so users see real squiggles for syntax,
 * semantic, and suggestion errors. The TS worker runs off the main thread,
 * so even a 10k-line file only debounces incremental compilation (~500ms in
 * VSCode's default) — it never blocks input.
 */
function configureLanguageDefaults(m: typeof monaco) {
  const ns = m as MonacoNs;

  // ─── TypeScript / JavaScript ────────────────────────────────────────
  try {
    const ts = ns.typescript;
    if (ts?.typescriptDefaults && ts?.javascriptDefaults) {
      const commonCompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        jsx: ts.JsxEmit.React,
        allowJs: true,
        allowNonTsExtensions: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        isolatedModules: true,
        strict: false, // snippet pad — full strict produces too many false positives
        noImplicitAny: false,
        skipLibCheck: true,
        lib: ['ESNext', 'DOM', 'DOM.Iterable', 'WebWorker'],
      };

      ts.typescriptDefaults.setCompilerOptions(commonCompilerOptions);
      ts.javascriptDefaults.setCompilerOptions(commonCompilerOptions);

      // ENABLE all diagnostics. The TS worker handles incremental analysis
      // off-thread; Monaco internally debounces re-validation at ~500ms after
      // the last edit, so even rapid typing is cheap.
      //
      // diagnosticCodesToIgnore: the codes below fire on every "uses bare
      // import" or "implicit any" in a single-file snippet — they'd be noise
      // without project context. This list mirrors VSCode's "no project" mode.
      const diagOpts = {
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false,
        diagnosticCodesToIgnore: [
          2304, // Cannot find name 'X'
          2307, // Cannot find module 'X'
          2792, // Cannot find module 'X'. Did you mean to set 'moduleResolution'
          1208, // 'X' cannot be compiled under '--isolatedModules'
          7016, // Could not find a declaration file for module 'X'
        ],
      };

      ts.typescriptDefaults.setDiagnosticsOptions(diagOpts);
      ts.javascriptDefaults.setDiagnosticsOptions(diagOpts);

      // Eager model sync intentionally LEFT OFF (default = false).
      //
      // It would push every open model into the TS worker on creation so
      // cross-file `import { x } from './other'` resolves — but it forces
      // the worker to spin up on the same tick the editor is constructing
      // its InstantiationService, and the race can throw
      // "InstantiationService has been disposed" on the next mount. For a
      // snippet pad with no real cross-file refs, the worker can lazy-sync
      // models on demand. VSCode itself only eagers per-workspace.

      // Inlay hints — off by default. Each hint is a DOM node + per-edit
      // re-query; in a snippet editor the signal-to-noise isn't worth the
      // render cost. Users can re-enable per-editor via the cog menu.
      ts.typescriptDefaults.setInlayHintsOptions?.({
        includeInlayParameterNameHints: 'none',
        includeInlayVariableTypeHints: false,
      });
      ts.javascriptDefaults.setInlayHintsOptions?.({
        includeInlayParameterNameHints: 'none',
      });
    }
  } catch (err) {
    console.error('[monaco] TS/JS defaults failed', err);
  }

  // ─── JSON ───────────────────────────────────────────────────────────
  try {
    if (ns.json?.jsonDefaults) {
      ns.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        trailingCommas: 'warning',
        schemaValidation: 'warning',
        schemaRequest: 'warning',
        comments: 'ignore',
      });
    }
  } catch (err) {
    console.error('[monaco] JSON defaults failed', err);
  }

  // ─── CSS / SCSS / LESS ──────────────────────────────────────────────
  try {
    const css = ns.css;
    if (css?.cssDefaults) {
      const cssOpts = {
        validate: true,
        lint: {
          compatibleVendorPrefixes: 'ignore',
          vendorPrefix: 'warning',
          duplicateProperties: 'warning',
          emptyRules: 'warning',
          importStatement: 'ignore',
          boxModel: 'ignore',
          universalSelector: 'ignore',
          zeroUnits: 'ignore',
          fontFaceProperties: 'warning',
          hexColorLength: 'error',
          argumentsInColorFunction: 'error',
          unknownProperties: 'warning',
          ieHack: 'ignore',
          unknownVendorSpecificProperties: 'ignore',
          propertyIgnoredDueToDisplay: 'warning',
          important: 'ignore',
          float: 'ignore',
          idSelector: 'ignore',
        },
      };
      css.cssDefaults.setOptions(cssOpts);
      css.scssDefaults?.setOptions(cssOpts);
      css.lessDefaults?.setOptions(cssOpts);
    }
  } catch (err) {
    console.error('[monaco] CSS defaults failed', err);
  }

  // ─── HTML ───────────────────────────────────────────────────────────
  try {
    if (ns.html?.htmlDefaults) {
      ns.html.htmlDefaults.setOptions({
        format: {
          tabSize: 2,
          insertSpaces: true,
          wrapLineLength: 120,
          unformatted: 'default"',
          contentUnformatted: 'pre,code,textarea',
          indentInnerHtml: false,
          preserveNewLines: true,
          maxPreserveNewLines: undefined,
          indentHandlebars: false,
          endWithNewline: false,
          extraLiners: 'head, body, /html',
          wrapAttributes: 'auto',
        },
        suggest: { html5: true },
      });
    }
  } catch (err) {
    console.error('[monaco] HTML defaults failed', err);
  }
}

export function configureMonacoOnce(): Promise<unknown> {
  if (g.__collabify_monaco_initPromise) return g.__collabify_monaco_initPromise;
  if (g.__collabify_monaco_configured) return Promise.resolve();
  g.__collabify_monaco_configured = true;
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

  // Configure language-service defaults on the bundled namespace BEFORE
  // any editor instantiates. The TS worker reads these on first spin-up.
  configureLanguageDefaults(monaco);

  g.__collabify_monaco_initPromise = loader
    .init()
    .then((m) => {
      // Belt-and-braces: in case the loader returned a different namespace,
      // re-apply themes + defaults so the editor never sees a half-configured
      // monaco instance.
      try {
        defineCatppuccinThemes(m as typeof monaco);
      } catch {}
      try {
        configureLanguageDefaults(m as typeof monaco);
      } catch {}
      return m;
    })
    .catch((err) => {
      console.error('[monaco] loader.init failed', err);
      g.__collabify_monaco_configured = false;
      g.__collabify_monaco_initPromise = null;
    });
  return g.__collabify_monaco_initPromise!;
}

/**
 * Spin up the TS/JS language workers on idle so the first real edit doesn't
 * pay the ~150–300 ms worker-instantiation cost. Equivalent to the `prewarm`
 * pattern VSCode uses on its extension host.
 *
 * Safe to call before or after `configureMonacoOnce()`; the implementation
 * waits for the loader to settle, then fires off worker creation in the
 * background. Errors are swallowed — failure to preload just means the
 * worker spins up lazily on the first edit, same as before this function.
 */
export function preloadLanguageWorkers(): void {
  if (typeof window === 'undefined') return;
  const schedule = (cb: () => void) => {
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => void })
        .requestIdleCallback(cb);
    } else {
      setTimeout(cb, 1500);
    }
  };
  schedule(() => {
    configureMonacoOnce()
      .then(() => {
        const ns = monaco as MonacoNs;
        // Calling getTypeScriptWorker() with no model URI returns a factory;
        // we don't need to actually invoke the factory — the act of asking
        // for it instantiates the worker. Same for JS.
        ns.typescript?.getTypeScriptWorker?.().catch(() => {});
        ns.typescript?.getJavaScriptWorker?.().catch(() => {});
      })
      .catch(() => {});
  });
}

