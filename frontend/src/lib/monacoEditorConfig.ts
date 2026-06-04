'use client';

// Shared editor utilities for the two Monaco wrappers in this app.
//
// Centralising the editor `options` block here:
//   • Single source of truth — Modern + Collab wrappers always agree.
//   • Hot-path tunings (minimap, hover delay, occurrences) live in one place.
//   • Theme/font swaps don't require touching two files.
//
// Plus shared rAF-coalesced ResizeObserver + a single-stylesheet peer cursor
// registry for y-monaco awareness.

import type * as Monaco from 'monaco-editor';

// ─── Editor options (production-grade defaults) ────────────────────────
//
// Tuned to match what VSCode ships out-of-the-box, with the deltas a
// browser-hosted snippet pad benefits from:
//   • automaticLayout: false        — we observe the container ourselves
//                                     (debounced via rAF) instead of the
//                                     100ms internal poll.
//   • minimap.renderCharacters:false — blocks render 5–10× cheaper than
//                                     glyph rasterisation; visually identical
//                                     at minimap scale.
//   • stickyScroll: false            — disabled by default in VSCode for the
//                                     same render-cost reason.
//   • hover.delay: 300               — matches VSCode default (workbench.json).
//   • occurrencesHighlight off       — saves a full-document scan per cursor
//                                     move; users rarely notice in snippets.

export function buildEditorOptions(
  fontSize: number,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    // Layout — disabled because we drive it via ResizeObserver below.
    // `automaticLayout: true` runs a setInterval(100ms) clientWidth/Height
    // poll, which is wasted work when we already have an RO on the parent.
    automaticLayout: false,

    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontLigatures: true,
    lineHeight: 1.55,
    letterSpacing: 0,

    // Minimap — character rendering on for full visual fidelity. Monaco
    // rasterises glyphs to an off-screen canvas once per font/theme combo
    // and reuses the atlas, so the per-edit cost is just the diffed lines.
    minimap: {
      enabled: true,
      showSlider: 'mouseover',
      renderCharacters: true,
      maxColumn: 120,
      scale: 1,
      side: 'right',
    },

    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    scrollBeyondLastLine: false,
    smoothScrolling: false, // smooth scroll fights track-pad momentum; off matches VSCode
    mouseWheelZoom: false,
    cursorBlinking: 'smooth',
    // No caret animation — `cursorSmoothCaretAnimation: 'on'` interpolates
    // the I-beam position over ~80ms when you click/jump, leaving a visible
    // ghost trail. Off (the VSCode default) makes the cursor snap.
    cursorSmoothCaretAnimation: 'off',
    cursorSurroundingLines: 3,
    cursorSurroundingLinesStyle: 'default',

    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    glyphMargin: true,        // gutter space for diagnostic icons
    folding: true,
    foldingStrategy: 'indentation',
    showFoldingControls: 'mouseover',
    renderLineHighlight: 'line',
    renderWhitespace: 'selection',
    renderControlCharacters: false,
    roundedSelection: false,

    padding: { top: 16, bottom: 16 },

    // Bracket highlighting — colorisation is cheap (handled in worker);
    // pair guides on the active line only is the VSCode default.
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    guides: {
      bracketPairs: false,             // off — overlap with indent guides at small zooms
      bracketPairsHorizontal: 'active',
      highlightActiveBracketPair: true,
      indentation: true,
      highlightActiveIndentation: true,
    },

    contextmenu: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
      alwaysConsumeMouseWheel: false,
    },

    // Sticky scroll — known render-cost feature. Off by default in our app.
    stickyScroll: { enabled: false },

    // Diagnostics surface
    hover: { enabled: true, delay: 300, sticky: true },
    // Always show squiggles, even if the file is read-only (default is
    // 'editable' which hides them in non-editable models). Matches VSCode's
    // explicit ON for consistency between collab read views and edit views.
    renderValidationDecorations: 'on',

    // Semantic highlighting — uses the TS/JS worker's symbol info to refine
    // colors past what TextMate scopes alone provide (distinguishes
    // parameters from locals, imported symbols, readonly fields, etc.).
    // VSCode ships this on by default since 1.43.
    'semanticHighlighting.enabled': true,

    // Inline color swatches for CSS/SCSS color literals (hex, rgb(), hsl()).
    // VSCode default. Cheap — the language service emits them as decorations.
    colorDecorators: true,

    // Skip the ambiguous-character scan that VSCode runs on every keystroke
    // to flag homoglyphs (Cyrillic а vs Latin a, etc.). It's a full-document
    // pass, and snippets never paste enough untrusted text to warrant it.
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
      nonBasicASCII: false,
    },

    // Disable the "paste as" picker that appears for rich clipboard payloads
    // (e.g. multi-format HTML). Snippet pad only cares about plain text.
    pasteAs: { enabled: false },

    // Drag-and-drop text from outside the editor — VSCode default.
    dropIntoEditor: { enabled: true },

    // Quick suggestions / IntelliSense — keep on with conservative trigger
    // thresholds so the worker isn't queried on every keystroke.
    quickSuggestions: { other: 'on', comments: 'off', strings: 'off' },
    quickSuggestionsDelay: 10,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    acceptSuggestionOnCommitCharacter: true,
    suggestSelection: 'first',
    tabCompletion: 'on',
    wordBasedSuggestions: 'matchingDocuments',
    parameterHints: { enabled: true, cycle: true },
    inlayHints: { enabled: 'offUnlessPressed' }, // off by default — render cost adds up

    // Occurrences / selection highlight — disabled to skip the per-cursor
    // document scan. Trade-off is acceptable for a snippet editor.
    occurrencesHighlight: 'off',
    selectionHighlight: false,

    // Format / indent
    formatOnPaste: false,
    formatOnType: false,
    autoIndent: 'advanced',
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: true,
    trimAutoWhitespace: true,

    // Misc niceties
    dragAndDrop: true,
    copyWithSyntaxHighlighting: true,
    emptySelectionClipboard: true,
    multiCursorModifier: 'alt',
    multiCursorMergeOverlapping: true,
    accessibilitySupport: 'auto',

    // Large-file safety nets
    largeFileOptimizations: true,
    maxTokenizationLineLength: 20_000,

    // Linked editing (rename HTML tag pair, etc.)
    linkedEditing: true,

    // Editor-wide find widget
    find: { addExtraSpaceOnTop: false, autoFindInSelection: 'multiline' },
  };
}

// ─── rAF-coalesced ResizeObserver ──────────────────────────────────────
//
// A naive RO callback fires for every resize event — during a window drag
// that's ~120 fires/sec. We coalesce to one `editor.layout()` per animation
// frame, which is what VSCode's `EditorAutoLayout` does internally when
// `automaticLayout: true` is enabled. We do it ourselves so we can disable
// the 100ms polling fallback.
//
// During an interactive sidebar/panel drag, the consumer can call
// `setEditorLayoutSuspended(true)` — RO callbacks become no-ops for the
// duration and a single `editor.layout()` flushes on resume. This is what
// VSCode does in its `Sash` widget: sashes pause grid layout while the
// pointer is captured and replay one layout pass on release. Without it,
// `editor.layout()` runs every frame of the drag and the cursor visibly
// out-paces the sidebar edge.
//
// Returns a disposer; safe to call multiple times.

const trackedEditors = new Set<Monaco.editor.IStandaloneCodeEditor>();
let layoutSuspended = false;

export function setEditorLayoutSuspended(suspended: boolean): void {
  if (layoutSuspended === suspended) return;
  layoutSuspended = suspended;
  if (suspended) return;
  // On resume, force a single layout pass on every tracked editor so any
  // container-size changes that happened during the suspension are picked
  // up. Skips disposed editors.
  for (const editor of trackedEditors) {
    try {
      const node = editor.getContainerDomNode();
      if (node && node.isConnected) editor.layout();
    } catch {
      /* disposed mid-iter */
    }
  }
}

export function observeEditorLayout(
  editor: Monaco.editor.IStandaloneCodeEditor,
): () => void {
  const container = editor.getContainerDomNode().parentElement;
  if (!container || typeof ResizeObserver === 'undefined') {
    return () => {};
  }

  trackedEditors.add(editor);

  let rafId = 0;
  let lastW = 0;
  let lastH = 0;

  const flush = () => {
    rafId = 0;
    if (layoutSuspended) return;
    const node = editor.getContainerDomNode();
    if (!node || !node.isConnected) return;
    editor.layout();
  };

  const ro = new ResizeObserver((entries) => {
    // Skip if dimensions didn't actually change (RO fires on style writes
    // that don't visually change box size, e.g. transform).
    for (const entry of entries) {
      const cr = entry.contentRect;
      if (cr.width === lastW && cr.height === lastH) continue;
      lastW = cr.width;
      lastH = cr.height;
    }
    if (layoutSuspended) return;        // dropped — `setEditorLayoutSuspended(false)` will replay
    if (rafId) return;
    rafId = requestAnimationFrame(flush);
  });

  ro.observe(container);
  const dispose = () => {
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
    trackedEditors.delete(editor);
  };
  editor.onDidDispose(dispose);
  return dispose;
}

// ─── Language-id mapping ───────────────────────────────────────────────
//
// App's `language` field is the display name from `detectLanguage`
// ("TypeScript", "C++"). Monaco's language registry uses lowercase ids.

export const LANGUAGE_ID_MAP: Record<string, string> = {
  JavaScript: 'javascript',
  TypeScript: 'typescript',
  Python: 'python',
  Java: 'java',
  'C++': 'cpp',
  C: 'c',
  'C#': 'csharp',
  Go: 'go',
  Rust: 'rust',
  Ruby: 'ruby',
  PHP: 'php',
  Swift: 'swift',
  Kotlin: 'kotlin',
  Dart: 'dart',
  Scala: 'scala',
  Lua: 'lua',
  R: 'r',
  Perl: 'perl',
  HTML: 'html',
  CSS: 'css',
  SCSS: 'scss',
  Less: 'less',
  JSON: 'json',
  XML: 'xml',
  SVG: 'xml',
  YAML: 'yaml',
  TOML: 'ini',
  INI: 'ini',
  Markdown: 'markdown',
  Shell: 'shell',
  PowerShell: 'powershell',
  Batch: 'bat',
  SQL: 'sql',
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GraphQL: 'graphql',
  JSX: 'javascript',
  TSX: 'typescript',
  Vue: 'html',
  Diff: 'diff',
  Protobuf: 'proto',
  LaTeX: 'latex',
  CoffeeScript: 'coffeescript',
  Clojure: 'clojure',
  Haskell: 'haskell',
  Elixir: 'elixir',
  Erlang: 'erlang',
  OCaml: 'ocaml',
  Julia: 'julia',
  Solidity: 'sol',
  Assembly: 'asm',
  Verilog: 'verilog',
  VHDL: 'vhdl',
  CMake: 'cmake',
  reStructuredText: 'restructuredtext',
};

export function toMonacoLanguageId(displayName: string): string {
  if (!displayName) return 'plaintext';
  return LANGUAGE_ID_MAP[displayName] || displayName.toLowerCase() || 'plaintext';
}
