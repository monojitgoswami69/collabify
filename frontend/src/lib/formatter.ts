'use client';

// Lazy Prettier formatting — the parsers load on first use, keeping the
// multi-MB formatter out of the main bundle.

type ParserName =
  | 'typescript'
  | 'babel'
  | 'json'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'markdown'
  | 'yaml';

const LANGUAGE_PARSERS: Record<string, ParserName> = {
  TypeScript: 'typescript',
  JavaScript: 'babel',
  JSON: 'json',
  CSS: 'css',
  SCSS: 'scss',
  Less: 'less',
  HTML: 'html',
  Markdown: 'markdown',
  YAML: 'yaml',
};

export function formatterLanguages(): string[] {
  return Object.keys(LANGUAGE_PARSERS);
}

export async function formatCode(code: string, language: string): Promise<string> {
  const parser = LANGUAGE_PARSERS[language];
  if (!parser) throw new Error(`No formatter available for ${language || 'this file type'}`);

  const [{ format }, babel, estree, typescript, postcss, html, markdown, yaml] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/html'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
  ]);

  const plugins = [babel, estree, typescript, postcss, html, markdown, yaml];
  const formatted = await format(code, {
    parser,
    plugins,
    tabWidth: 2,
    printWidth: 100,
  });
  return formatted;
}
