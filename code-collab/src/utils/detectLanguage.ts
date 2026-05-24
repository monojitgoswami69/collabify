// Two-tier language detection: synchronous extension lookup + async Magika AI.

import { Magika } from 'magika';

const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', pyw: 'Python', pyi: 'Python',
  cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hxx: 'C++',
  c: 'C', h: 'C',
  java: 'Java',
  go: 'Go',
  rs: 'Rust',
  rb: 'Ruby', erb: 'Ruby',
  php: 'PHP',
  html: 'HTML', htm: 'HTML',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  json: 'JSON', jsonc: 'JSON',
  md: 'Markdown', mdx: 'Markdown',
  yaml: 'YAML', yml: 'YAML',
  xml: 'XML', svg: 'XML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  sql: 'SQL',
  r: 'R',
  swift: 'Swift',
  kt: 'Kotlin', kts: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  scala: 'Scala',
  toml: 'TOML',
  ini: 'INI',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
};

const MAGIKA_LABEL_MAP: Record<string, string> = {
  javascript: 'JavaScript', jsx: 'JavaScript',
  typescript: 'TypeScript', tsx: 'TypeScript',
  python: 'Python',
  c: 'C', h: 'C',
  cpp: 'C++', hpp: 'C++',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby', erb: 'Ruby',
  php: 'PHP',
  cs: 'C#',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  scala: 'Scala',
  perl: 'Perl',
  r: 'R',
  html: 'HTML',
  css: 'CSS', scss: 'SCSS', less: 'Less',
  json: 'JSON', jsonc: 'JSON', jsonl: 'JSON',
  xml: 'XML', svg: 'SVG', xsd: 'XML',
  markdown: 'Markdown', rst: 'reStructuredText',
  yaml: 'YAML',
  shell: 'Shell', batch: 'Batch', powershell: 'PowerShell',
  awk: 'AWK', tcl: 'Tcl',
  asm: 'Assembly', verilog: 'Verilog', vhdl: 'VHDL',
  groovy: 'Groovy', clojure: 'Clojure',
  haskell: 'Haskell', elixir: 'Elixir', erlang: 'Erlang',
  ocaml: 'OCaml', lisp: 'Lisp', scheme: 'Scheme',
  zig: 'Zig', nim: 'Nim', julia: 'Julia', gleam: 'Gleam',
  solidity: 'Solidity', prolog: 'Prolog',
  coffeescript: 'CoffeeScript', vue: 'Vue',
  sql: 'SQL',
  toml: 'TOML', ini: 'INI', csv: 'CSV', tsv: 'TSV',
  dockerfile: 'Dockerfile', makefile: 'Makefile',
  cmake: 'CMake', bazel: 'Bazel', gradle: 'Gradle',
  proto: 'Protobuf', protobuf: 'Protobuf',
  latex: 'LaTeX', diff: 'Diff',
  txt: 'Text', txtascii: 'Text', txtutf8: 'Text', txtutf16: 'Text',
};

export function detectLanguage(fileName: string, _content: string): string {
  if (!fileName) return '';
  const baseName = fileName.split('/').pop()?.toLowerCase() || '';
  if (baseName === 'dockerfile') return 'Dockerfile';
  if (baseName === 'makefile' || baseName === 'gnumakefile') return 'Makefile';
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
  return '';
}

let magikaInstance: Magika | null = null;
let magikaInitPromise: Promise<Magika> | null = null;

async function getMagika(): Promise<Magika> {
  if (magikaInstance) return magikaInstance;
  if (magikaInitPromise) return magikaInitPromise;

  magikaInitPromise = Magika.create().then((instance) => {
    magikaInstance = instance;
    return instance;
  });
  return magikaInitPromise;
}

export async function detectLanguageAI(fileName: string, content: string): Promise<string> {
  const extResult = detectLanguage(fileName, content);
  if (!content || content.trim().length < 20) {
    return extResult || '';
  }
  try {
    const magika = await getMagika();
    const bytes = new TextEncoder().encode(content);
    const prediction = await magika.identifyBytes(bytes);
    const label = prediction?.prediction?.output?.label || '';
    const mappedLanguage = MAGIKA_LABEL_MAP[label] || '';
    if (mappedLanguage && mappedLanguage !== 'Text') {
      return mappedLanguage;
    }
    return extResult || mappedLanguage || '';
  } catch {
    return extResult || '';
  }
}

// Preload model in the background (browser only)
if (typeof window !== 'undefined') {
  getMagika().catch(() => {});
}
