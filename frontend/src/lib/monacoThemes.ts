// Catppuccin themes — single source of truth.
//
// Defined globally once (in monacoBootstrap) AND on each editor's beforeMount,
// so Monaco never has a chance to render its default vs-dark/vs theme.
//
// The token rule tables below are intentionally exhaustive. Monaco emits both
// Monarch-style tokens ("keyword.ts", "identifier", "tag", "attribute.name")
// AND, when a TextMate grammar is registered (markdown, jsx, etc), full TM
// scopes ("entity.name.tag.html", "string.regexp.js", "markup.heading.md").
// We map both shapes so unmatched tokens never fall through to vs-default.
//
// Palette references the canonical Catppuccin spec:
//   Mocha — https://github.com/catppuccin/catppuccin#-palettes
//   Latte — https://github.com/catppuccin/catppuccin#-palettes

import type * as Monaco from 'monaco-editor';

// ─── Palettes ───────────────────────────────────────────────────────────
// (kept as plain hex strings so the rules table reads at a glance)

const MOCHA = {
  rosewater: 'f5e0dc',
  flamingo:  'f2cdcd',
  pink:      'f5c2e7',
  mauve:     'cba6f7',
  red:       'f38ba8',
  maroon:    'eba0ac',
  peach:     'fab387',
  yellow:    'f9e2af',
  green:     'a6e3a1',
  teal:      '94e2d5',
  sky:       '89dceb',
  sapphire:  '74c7ec',
  blue:      '89b4fa',
  lavender:  'b4befe',
  text:      'cdd6f4',
  subtext1:  'bac2de',
  subtext0:  'a6adc8',
  overlay2:  '9399b2',
  overlay1:  '7f849c',
  overlay0:  '6c7086',
  surface2:  '585b70',
  surface1:  '45475a',
  surface0:  '313244',
  base:      '1e1e2e',
  mantle:    '181825',
  crust:     '11111b',
};

const LATTE = {
  rosewater: 'dc8a78',
  flamingo:  'dd7878',
  pink:      'ea76cb',
  mauve:     '8839ef',
  red:       'd20f39',
  maroon:    'e64553',
  peach:     'fe640b',
  yellow:    'df8e1d',
  green:     '40a02b',
  teal:      '179299',
  sky:       '04a5e5',
  sapphire:  '209fb5',
  blue:      '1e66f5',
  lavender:  '7287fd',
  text:      '4c4f69',
  subtext1:  '5c5f77',
  subtext0:  '6c6f85',
  overlay2:  '7c7f93',
  overlay1:  '8c8fa1',
  overlay0:  '9ca0b0',
  surface2:  'acb0be',
  surface1:  'bcc0cc',
  surface0:  'ccd0da',
  base:      'eff1f5',
  mantle:    'e6e9ef',
  crust:     'dce0e8',
};

type Palette = typeof MOCHA;

// Build the rules table from a palette so mocha/latte share the exact
// same scope→role mapping — only the hex values differ. This is the
// pattern used by the official @catppuccin/vscode port.
function buildRules(p: Palette): Monaco.editor.ITokenThemeRule[] {
  return [
    // ── Base / fallback ────────────────────────────────────────────
    { token: '',                                  foreground: p.text },
    { token: 'source',                            foreground: p.text },
    { token: 'identifier',                        foreground: p.text },
    { token: 'meta',                              foreground: p.text },

    // ── Comments ───────────────────────────────────────────────────
    { token: 'comment',                           foreground: p.overlay0, fontStyle: 'italic' },
    { token: 'comment.line',                      foreground: p.overlay0, fontStyle: 'italic' },
    { token: 'comment.block',                     foreground: p.overlay0, fontStyle: 'italic' },
    { token: 'comment.block.documentation',       foreground: p.overlay0, fontStyle: 'italic' },
    { token: 'punctuation.definition.comment',    foreground: p.overlay0 },

    // ── Strings ────────────────────────────────────────────────────
    { token: 'string',                            foreground: p.green },
    { token: 'string.quoted',                     foreground: p.green },
    { token: 'string.quoted.single',              foreground: p.green },
    { token: 'string.quoted.double',              foreground: p.green },
    { token: 'string.template',                   foreground: p.green },
    { token: 'string.interpolated',               foreground: p.green },
    { token: 'string.unquoted',                   foreground: p.green },
    { token: 'string.escape',                     foreground: p.pink },
    { token: 'constant.character.escape',         foreground: p.pink },
    { token: 'punctuation.definition.string',     foreground: p.green },
    { token: 'string.regexp',                     foreground: p.peach },
    { token: 'regexp',                            foreground: p.peach },

    // ── Numbers / constants / language constants ───────────────────
    { token: 'number',                            foreground: p.peach },
    { token: 'number.hex',                        foreground: p.peach },
    { token: 'number.float',                      foreground: p.peach },
    { token: 'constant',                          foreground: p.peach },
    { token: 'constant.numeric',                  foreground: p.peach },
    { token: 'constant.language',                 foreground: p.peach },           // true / false / null / nil
    { token: 'constant.language.boolean',         foreground: p.peach },
    { token: 'constant.language.null',            foreground: p.peach },
    { token: 'constant.language.undefined',       foreground: p.peach },
    { token: 'constant.other',                    foreground: p.peach },
    { token: 'constant.other.color',              foreground: p.pink },
    { token: 'predefined',                        foreground: p.peach },

    // ── Keywords / control flow ────────────────────────────────────
    { token: 'keyword',                           foreground: p.mauve },
    { token: 'keyword.control',                   foreground: p.mauve },
    { token: 'keyword.control.flow',              foreground: p.mauve },
    { token: 'keyword.control.import',            foreground: p.mauve },
    { token: 'keyword.control.from',              foreground: p.mauve },
    { token: 'keyword.control.return',            foreground: p.mauve },
    { token: 'keyword.control.conditional',       foreground: p.mauve },
    { token: 'keyword.control.loop',              foreground: p.mauve },
    { token: 'keyword.control.exception',         foreground: p.mauve },
    { token: 'keyword.declaration',               foreground: p.mauve },
    { token: 'keyword.operator',                  foreground: p.sky },
    { token: 'keyword.operator.new',              foreground: p.mauve },
    { token: 'keyword.operator.delete',           foreground: p.mauve },
    { token: 'keyword.operator.logical',          foreground: p.sky },
    { token: 'keyword.operator.arithmetic',       foreground: p.sky },
    { token: 'keyword.operator.assignment',       foreground: p.sky },
    { token: 'keyword.other',                     foreground: p.mauve },
    { token: 'keyword.other.unit',                foreground: p.peach },           // CSS units, etc.

    // ── Operators / delimiters / punctuation ───────────────────────
    { token: 'operator',                          foreground: p.sky },
    { token: 'operators',                         foreground: p.sky },
    { token: 'delimiter',                         foreground: p.overlay2 },
    { token: 'delimiter.bracket',                 foreground: p.overlay2 },
    { token: 'delimiter.parenthesis',             foreground: p.overlay2 },
    { token: 'delimiter.square',                  foreground: p.overlay2 },
    { token: 'delimiter.curly',                   foreground: p.overlay2 },
    { token: 'delimiter.angle',                   foreground: p.overlay2 },
    { token: 'delimiter.html',                    foreground: p.overlay2 },
    { token: 'punctuation',                       foreground: p.overlay2 },
    { token: 'punctuation.separator',             foreground: p.overlay2 },
    { token: 'punctuation.terminator',            foreground: p.overlay2 },
    { token: 'punctuation.accessor',              foreground: p.sky },             // the `.` in `foo.bar`
    { token: 'meta.brace',                        foreground: p.overlay2 },

    // ── Storage / modifiers / types ────────────────────────────────
    { token: 'storage',                           foreground: p.mauve },
    { token: 'storage.type',                      foreground: p.mauve },
    { token: 'storage.modifier',                  foreground: p.mauve },
    { token: 'storage.modifier.async',            foreground: p.mauve },
    { token: 'type',                              foreground: p.yellow },
    { token: 'type.identifier',                   foreground: p.yellow },
    { token: 'entity.name.type',                  foreground: p.yellow },
    { token: 'entity.name.type.class',            foreground: p.yellow },
    { token: 'entity.name.type.interface',        foreground: p.yellow },
    { token: 'entity.name.type.enum',             foreground: p.yellow },
    { token: 'entity.name.type.module',           foreground: p.yellow },
    { token: 'entity.name.class',                 foreground: p.yellow },
    { token: 'entity.name.namespace',             foreground: p.yellow },
    { token: 'entity.other.inherited-class',      foreground: p.yellow },
    { token: 'support.type',                      foreground: p.yellow },
    { token: 'support.class',                     foreground: p.yellow },
    { token: 'support.type.primitive',            foreground: p.yellow },
    { token: 'support.type.builtin',              foreground: p.yellow },

    // ── Functions / calls / decorators ─────────────────────────────
    { token: 'function',                          foreground: p.blue },
    { token: 'entity.name.function',              foreground: p.blue },
    { token: 'entity.name.function.member',       foreground: p.blue },
    { token: 'entity.name.function.constructor',  foreground: p.yellow },
    { token: 'meta.function-call',                foreground: p.blue },
    { token: 'support.function',                  foreground: p.blue },
    { token: 'support.function.builtin',          foreground: p.blue },
    { token: 'meta.decorator',                    foreground: p.blue },
    { token: 'entity.name.function.decorator',    foreground: p.blue },
    { token: 'annotation',                        foreground: p.blue },

    // ── Variables / parameters ─────────────────────────────────────
    { token: 'variable',                          foreground: p.text },
    { token: 'variable.parameter',                foreground: p.maroon, fontStyle: 'italic' },
    { token: 'variable.language',                 foreground: p.red,    fontStyle: 'italic' }, // this / self / super
    { token: 'variable.language.this',            foreground: p.red,    fontStyle: 'italic' },
    { token: 'variable.language.super',           foreground: p.red,    fontStyle: 'italic' },
    { token: 'variable.other',                    foreground: p.text },
    { token: 'variable.other.readwrite',          foreground: p.text },
    { token: 'variable.other.constant',           foreground: p.peach },
    { token: 'variable.other.object',             foreground: p.text },
    { token: 'variable.other.property',           foreground: p.text },
    { token: 'support.variable',                  foreground: p.text },
    { token: 'support.constant',                  foreground: p.peach },

    // ── Namespaces / modules ───────────────────────────────────────
    { token: 'namespace',                         foreground: p.yellow },
    { token: 'entity.name.module',                foreground: p.yellow },

    // ── HTML / XML / JSX tags ──────────────────────────────────────
    { token: 'tag',                               foreground: p.blue },
    { token: 'tag.id',                            foreground: p.blue },
    { token: 'tag.class',                         foreground: p.yellow },
    { token: 'metatag',                           foreground: p.mauve },
    { token: 'metatag.content',                   foreground: p.text },
    { token: 'entity.name.tag',                   foreground: p.blue },
    { token: 'entity.name.tag.html',              foreground: p.blue },
    { token: 'entity.name.tag.xml',               foreground: p.blue },
    { token: 'entity.name.tag.jsx',               foreground: p.blue },
    { token: 'entity.name.tag.tsx',               foreground: p.blue },
    { token: 'punctuation.definition.tag',        foreground: p.overlay2 },
    { token: 'attribute.name',                    foreground: p.yellow },
    { token: 'attribute.name.html',               foreground: p.yellow },
    { token: 'attribute.value',                   foreground: p.green },
    { token: 'attribute.value.unit',              foreground: p.peach },
    { token: 'entity.other.attribute-name',       foreground: p.yellow },
    { token: 'entity.other.attribute-name.id',    foreground: p.blue },
    { token: 'entity.other.attribute-name.class', foreground: p.yellow },

    // ── CSS / SCSS / LESS ──────────────────────────────────────────
    { token: 'attribute',                         foreground: p.yellow },
    { token: 'attribute.value.css',               foreground: p.green },
    { token: 'attribute.value.number.css',        foreground: p.peach },
    { token: 'attribute.value.hex.css',           foreground: p.pink },
    { token: 'support.type.property-name',        foreground: p.blue },
    { token: 'support.constant.property-value',   foreground: p.text },
    { token: 'entity.name.tag.css',               foreground: p.mauve },
    { token: 'entity.other.attribute-name.id.css',foreground: p.blue },
    { token: 'entity.other.attribute-name.class.css', foreground: p.yellow },
    { token: 'entity.other.attribute-name.pseudo-class.css', foreground: p.teal },
    { token: 'entity.other.attribute-name.pseudo-element.css', foreground: p.teal },

    // ── JSON ───────────────────────────────────────────────────────
    { token: 'string.key.json',                   foreground: p.blue },
    { token: 'string.value.json',                 foreground: p.green },
    { token: 'support.type.property-name.json',   foreground: p.blue },

    // ── Markdown / markup ──────────────────────────────────────────
    { token: 'markup.heading',                    foreground: p.red,   fontStyle: 'bold' },
    { token: 'markup.heading.1',                  foreground: p.red,   fontStyle: 'bold' },
    { token: 'markup.heading.2',                  foreground: p.peach, fontStyle: 'bold' },
    { token: 'markup.heading.3',                  foreground: p.yellow,fontStyle: 'bold' },
    { token: 'markup.heading.4',                  foreground: p.green, fontStyle: 'bold' },
    { token: 'markup.heading.5',                  foreground: p.sapphire, fontStyle: 'bold' },
    { token: 'markup.heading.6',                  foreground: p.mauve, fontStyle: 'bold' },
    { token: 'markup.bold',                       foreground: p.red,   fontStyle: 'bold' },
    { token: 'markup.italic',                     foreground: p.red,   fontStyle: 'italic' },
    { token: 'markup.strikethrough',              foreground: p.overlay0, fontStyle: 'strikethrough' },
    { token: 'markup.underline',                  foreground: p.sky,   fontStyle: 'underline' },
    { token: 'markup.underline.link',             foreground: p.sky,   fontStyle: 'underline' },
    { token: 'markup.quote',                      foreground: p.overlay1, fontStyle: 'italic' },
    { token: 'markup.list',                       foreground: p.teal },
    { token: 'markup.list.numbered',              foreground: p.teal },
    { token: 'markup.list.unnumbered',            foreground: p.teal },
    { token: 'markup.inline.raw',                 foreground: p.green },
    { token: 'markup.fenced_code',                foreground: p.green },
    { token: 'markup.raw',                        foreground: p.green },
    { token: 'markup.inserted',                   foreground: p.green },
    { token: 'markup.deleted',                    foreground: p.red },
    { token: 'markup.changed',                    foreground: p.yellow },
    { token: 'meta.link',                         foreground: p.blue },
    { token: 'string.other.link',                 foreground: p.blue },

    // ── Diff ───────────────────────────────────────────────────────
    { token: 'meta.diff',                         foreground: p.subtext0 },
    { token: 'meta.diff.header',                  foreground: p.blue },
    { token: 'meta.diff.range',                   foreground: p.mauve },

    // ── YAML / TOML / INI ──────────────────────────────────────────
    { token: 'entity.name.tag.yaml',              foreground: p.blue },
    { token: 'string.unquoted.plain.out.yaml',    foreground: p.text },
    { token: 'punctuation.definition.block.sequence.item.yaml', foreground: p.peach },

    // ── Shell / Bash ───────────────────────────────────────────────
    { token: 'variable.parameter.posix',          foreground: p.maroon, fontStyle: 'italic' },
    { token: 'string.interpolated.dollar.shell',  foreground: p.red },

    // ── SQL ────────────────────────────────────────────────────────
    { token: 'keyword.sql',                       foreground: p.mauve },
    { token: 'support.function.aggregate.sql',    foreground: p.blue },

    // ── Errors / invalid ───────────────────────────────────────────
    { token: 'invalid',                           foreground: p.red,   fontStyle: 'italic underline' },
    { token: 'invalid.illegal',                   foreground: p.red,   fontStyle: 'bold' },
    { token: 'invalid.deprecated',                foreground: p.yellow, fontStyle: 'strikethrough' },

    // ── Monaco-specific Monarch token shapes ───────────────────────
    // (some grammars emit `keyword.ts`, `string.regex.js`, etc. — these
    //  catch-alls keep colors stable when language-suffixed)
    { token: 'keyword.json',                      foreground: p.mauve },
    { token: 'string.key',                        foreground: p.blue },
    { token: 'string.value',                      foreground: p.green },
    { token: 'string.escape.js',                  foreground: p.pink },
    { token: 'string.escape.ts',                  foreground: p.pink },
    { token: 'string.regex',                      foreground: p.peach },
    { token: 'string.regex.js',                   foreground: p.peach },
    { token: 'string.regex.ts',                   foreground: p.peach },
  ];
}

// ─── Editor chrome colors ──────────────────────────────────────────────
// Editor background pins are intentionally set to the same colors that
// globals.css enforces (#232332 dark / #EEF1F5 light) so there is zero
// visible shift between Monaco's first paint and the CSS overrides.

function buildColorsMocha(p: Palette): Record<string, string> {
  return {
    'editor.background':                          '#232332',
    'editor.foreground':                          '#' + p.text,
    'editor.lineHighlightBackground':             '#2a2a3c',
    'editor.lineHighlightBorder':                 '#00000000',
    'editorLineNumber.foreground':                '#' + p.overlay0,
    'editorLineNumber.activeForeground':          '#' + p.text,
    'editor.selectionBackground':                 '#' + p.surface1,
    'editor.inactiveSelectionBackground':         '#' + p.surface0,
    'editor.selectionHighlightBackground':        '#' + p.surface0,
    'editor.wordHighlightBackground':             '#' + p.surface0,
    'editor.wordHighlightStrongBackground':       '#' + p.surface1,
    'editor.findMatchBackground':                 '#' + p.peach + '40',
    'editor.findMatchHighlightBackground':        '#' + p.peach + '25',
    'editor.hoverHighlightBackground':            '#' + p.surface0 + '80',
    'editorCursor.foreground':                    '#' + p.rosewater,
    'editorWhitespace.foreground':                '#' + p.surface1,
    'editorIndentGuide.background':               '#' + p.surface0,
    'editorIndentGuide.activeBackground':         '#' + p.overlay0,
    'editorLink.activeForeground':                '#' + p.blue,
    'editorBracketMatch.background':              '#' + p.surface1,
    'editorBracketMatch.border':                  '#' + p.overlay0,
    // Bracket pair colorization (catppuccin rainbow)
    'editorBracketHighlight.foreground1':         '#' + p.red,
    'editorBracketHighlight.foreground2':         '#' + p.peach,
    'editorBracketHighlight.foreground3':         '#' + p.yellow,
    'editorBracketHighlight.foreground4':         '#' + p.green,
    'editorBracketHighlight.foreground5':         '#' + p.sky,
    'editorBracketHighlight.foreground6':         '#' + p.mauve,
    'editorBracketHighlight.unexpectedBracket.foreground': '#' + p.red,
    // Diagnostics — error / warning / info / hint squiggles
    'editorError.foreground':                     '#' + p.red,
    'editorError.border':                         '#00000000',
    'editorWarning.foreground':                   '#' + p.yellow,
    'editorWarning.border':                       '#00000000',
    'editorInfo.foreground':                      '#' + p.sky,
    'editorInfo.border':                          '#00000000',
    'editorHint.foreground':                      '#' + p.teal,
    'editorGutter.background':                    '#232332',
    'editorGutter.modifiedBackground':            '#' + p.yellow,
    'editorGutter.addedBackground':               '#' + p.green,
    'editorGutter.deletedBackground':             '#' + p.red,
    // Suggest / hover / widget surfaces
    'editorWidget.background':                    '#' + p.mantle,
    'editorWidget.border':                        '#' + p.surface0,
    'editorSuggestWidget.background':             '#' + p.mantle,
    'editorSuggestWidget.border':                 '#' + p.surface0,
    'editorSuggestWidget.foreground':             '#' + p.text,
    'editorSuggestWidget.selectedBackground':     '#' + p.surface0,
    'editorSuggestWidget.highlightForeground':    '#' + p.blue,
    'editorHoverWidget.background':               '#' + p.mantle,
    'editorHoverWidget.border':                   '#' + p.surface0,
    // Scrollbar
    'scrollbar.shadow':                           '#00000000',
    'scrollbarSlider.background':                 '#' + p.surface1 + '80',
    'scrollbarSlider.hoverBackground':            '#' + p.surface2 + 'a0',
    'scrollbarSlider.activeBackground':           '#' + p.overlay0 + 'a0',
    // Minimap
    'minimap.findMatchHighlight':                 '#' + p.peach,
    'minimap.errorHighlight':                     '#' + p.red,
    'minimap.warningHighlight':                   '#' + p.yellow,
    'minimapSlider.background':                   '#' + p.surface1 + '60',
    'minimapSlider.hoverBackground':              '#' + p.surface2 + '80',
    'minimapSlider.activeBackground':             '#' + p.overlay0 + '80',
  };
}

function buildColorsLatte(p: Palette): Record<string, string> {
  return {
    'editor.background':                          '#EEF1F5',
    'editor.foreground':                          '#' + p.text,
    'editor.lineHighlightBackground':             '#e6e9ef',
    'editor.lineHighlightBorder':                 '#00000000',
    'editorLineNumber.foreground':                '#' + p.overlay0,
    'editorLineNumber.activeForeground':          '#' + p.text,
    'editor.selectionBackground':                 '#' + p.surface0,
    'editor.inactiveSelectionBackground':         '#' + p.mantle,
    'editor.selectionHighlightBackground':        '#' + p.surface0 + '80',
    'editor.wordHighlightBackground':             '#' + p.surface0 + '80',
    'editor.wordHighlightStrongBackground':       '#' + p.surface0,
    'editor.findMatchBackground':                 '#' + p.peach + '50',
    'editor.findMatchHighlightBackground':        '#' + p.peach + '30',
    'editor.hoverHighlightBackground':            '#' + p.surface0 + '80',
    'editorCursor.foreground':                    '#' + p.rosewater,
    'editorWhitespace.foreground':                '#' + p.surface0,
    'editorIndentGuide.background':               '#' + p.surface0,
    'editorIndentGuide.activeBackground':         '#' + p.overlay0,
    'editorLink.activeForeground':                '#' + p.blue,
    'editorBracketMatch.background':              '#' + p.surface0,
    'editorBracketMatch.border':                  '#' + p.overlay0,
    'editorBracketHighlight.foreground1':         '#' + p.red,
    'editorBracketHighlight.foreground2':         '#' + p.peach,
    'editorBracketHighlight.foreground3':         '#' + p.yellow,
    'editorBracketHighlight.foreground4':         '#' + p.green,
    'editorBracketHighlight.foreground5':         '#' + p.sky,
    'editorBracketHighlight.foreground6':         '#' + p.mauve,
    'editorBracketHighlight.unexpectedBracket.foreground': '#' + p.red,
    'editorError.foreground':                     '#' + p.red,
    'editorError.border':                         '#00000000',
    'editorWarning.foreground':                   '#' + p.yellow,
    'editorWarning.border':                       '#00000000',
    'editorInfo.foreground':                      '#' + p.sky,
    'editorInfo.border':                          '#00000000',
    'editorHint.foreground':                      '#' + p.teal,
    'editorGutter.background':                    '#EEF1F5',
    'editorGutter.modifiedBackground':            '#' + p.yellow,
    'editorGutter.addedBackground':               '#' + p.green,
    'editorGutter.deletedBackground':             '#' + p.red,
    'editorWidget.background':                    '#' + p.mantle,
    'editorWidget.border':                        '#' + p.surface0,
    'editorSuggestWidget.background':             '#' + p.mantle,
    'editorSuggestWidget.border':                 '#' + p.surface0,
    'editorSuggestWidget.foreground':             '#' + p.text,
    'editorSuggestWidget.selectedBackground':     '#' + p.surface0,
    'editorSuggestWidget.highlightForeground':    '#' + p.blue,
    'editorHoverWidget.background':               '#' + p.mantle,
    'editorHoverWidget.border':                   '#' + p.surface0,
    'scrollbar.shadow':                           '#00000000',
    'scrollbarSlider.background':                 '#' + p.surface0 + '80',
    'scrollbarSlider.hoverBackground':            '#' + p.surface1 + 'a0',
    'scrollbarSlider.activeBackground':           '#' + p.overlay0 + 'a0',
    'minimap.findMatchHighlight':                 '#' + p.peach,
    'minimap.errorHighlight':                     '#' + p.red,
    'minimap.warningHighlight':                   '#' + p.yellow,
    'minimapSlider.background':                   '#' + p.surface0 + '60',
    'minimapSlider.hoverBackground':              '#' + p.surface1 + '80',
    'minimapSlider.activeBackground':             '#' + p.overlay0 + '80',
  };
}

export const CATPPUCCIN_MOCHA: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: buildRules(MOCHA),
  colors: buildColorsMocha(MOCHA),
};

export const CATPPUCCIN_LATTE: Monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: buildRules(LATTE),
  colors: buildColorsLatte(LATTE),
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
