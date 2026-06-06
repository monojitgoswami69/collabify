'use client';

// Shared editor utilities for the two Monaco wrappers in this app.
//
// Centralising the editor `options` block here:
//   • Single source of truth — Modern + Collab wrappers always agree.
//   • Hot-path tunings (minimap, hover delay, occurrences) live in one place.
//   • Theme/font swaps don't require touching two files.

import type * as Monaco from 'monaco-editor';

// ─── Editor options (production-grade defaults) ────────────────────────
//
// Tuned to match what VSCode ships out-of-the-box, with the deltas a
// browser-hosted snippet pad benefits from:
//   • automaticLayout: true          — Monaco's own ResizeObserver-based
//                                     layout. In 0.55 it's rAF-coalesced
//                                     AND passes the observed dimensions
//                                     straight into `editor.layout(dim)`,
//                                     skipping the synchronous bounding-box
//                                     read that a hand-rolled `editor.layout()`
//                                     call forces. Trust Monaco's path —
//                                     it's strictly faster than ours was
//                                     and it cooperates with the sash drag
//                                     and chat-panel grid animation without
//                                     any external suspension state.
//   • minimap.renderCharacters:true — glyphs render to canvas via Monaco's
//                                     atlas; cheap after the first paint.
//   • stickyScroll: false            — disabled by default in VSCode for the
//                                     same render-cost reason.
//   • hover.delay: 300               — matches VSCode default (workbench.json).
//   • occurrencesHighlight off       — saves a full-document scan per cursor
//                                     move; users rarely notice in snippets.

export function buildEditorOptions(
  fontSize: number,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: false,

    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontLigatures: true,
    lineHeight: 1.55,
    letterSpacing: 0,

    // Minimap — character rendering on. Note: `renderCharacters: false`
    // looks like a perf win but per microsoft/vscode#51908 it also changes
    // minimap geometry (~150% line height in block mode), so it's not a
    // pure perf toggle — leave on.
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
