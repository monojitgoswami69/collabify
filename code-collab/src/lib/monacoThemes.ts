// Catppuccin themes — single source of truth.
// Defined globally once (in monacoBootstrap) AND on each editor's beforeMount,
// so Monaco never has a chance to render its default vs-dark/vs theme.

import type * as Monaco from 'monaco-editor';

// Editor background pins are intentionally set to the same colors that
// globals.css enforces (#232332 dark / #EEF1F5 light) so there is zero
// visible shift between Monaco's first paint and the CSS overrides.
export const CATPPUCCIN_MOCHA: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cba6f7' },
    { token: 'string', foreground: 'a6e3a1' },
    { token: 'number', foreground: 'fab387' },
    { token: 'type', foreground: 'f9e2af' },
    { token: 'function', foreground: '89b4fa' },
    { token: 'variable', foreground: 'cdd6f4' },
    { token: 'operator', foreground: '94e2d5' },
  ],
  colors: {
    'editor.background': '#232332',
    'editor.foreground': '#cdd6f4',
    'editor.lineHighlightBackground': '#2a2a3c',
    'editorLineNumber.foreground': '#6c7086',
    'editorLineNumber.activeForeground': '#cdd6f4',
    'editor.selectionBackground': '#45475a',
    'editor.inactiveSelectionBackground': '#313244',
    'editorCursor.foreground': '#f5e0dc',
    'editorWhitespace.foreground': '#45475a',
    'editorIndentGuide.background': '#45475a',
    'editorIndentGuide.activeBackground': '#6c7086',
  },
};

export const CATPPUCCIN_LATTE: Monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '9ca0b0', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8839ef' },
    { token: 'string', foreground: '40a02b' },
    { token: 'number', foreground: 'fe640b' },
    { token: 'type', foreground: 'df8e1d' },
    { token: 'function', foreground: '1e66f5' },
    { token: 'variable', foreground: '4c4f69' },
    { token: 'operator', foreground: '179299' },
  ],
  colors: {
    'editor.background': '#EEF1F5',
    'editor.foreground': '#4c4f69',
    'editor.lineHighlightBackground': '#e6e9ef',
    'editorLineNumber.foreground': '#9ca0b0',
    'editorLineNumber.activeForeground': '#4c4f69',
    'editor.selectionBackground': '#ccd0da',
    'editor.inactiveSelectionBackground': '#e6e9ef',
    'editorCursor.foreground': '#dc8a78',
    'editorWhitespace.foreground': '#ccd0da',
    'editorIndentGuide.background': '#ccd0da',
    'editorIndentGuide.activeBackground': '#9ca0b0',
  },
};

let defined = false;

/**
 * Idempotently register both themes on a monaco namespace.
 * Safe to call from `beforeMount` and from the global loader bootstrap.
 */
export function defineCatppuccinThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme('catppuccin-mocha', CATPPUCCIN_MOCHA);
  monaco.editor.defineTheme('catppuccin-latte', CATPPUCCIN_LATTE);
  defined = true;
}

export function themesDefined() {
  return defined;
}
