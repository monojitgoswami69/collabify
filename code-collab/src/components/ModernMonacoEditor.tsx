'use client';

import { useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import { StoredFile } from '@/services/storageService';
import { configureMonacoOnce } from '@/lib/monacoBootstrap';
import { defineCatppuccinThemes } from '@/lib/monacoThemes';


interface Props {
  file: StoredFile;
  theme: 'dark' | 'light';
  fontSize: number;
  onChange: (value: string) => void;
  onCursorChange: (ln: number, col: number) => void;
  onSelectionChange: (count: number) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  JavaScript: 'javascript',
  TypeScript: 'typescript',
  Python: 'python',
  Java: 'java',
  'C++': 'cpp',
  C: 'c',
  Go: 'go',
  Rust: 'rust',
  Ruby: 'ruby',
  PHP: 'php',
  HTML: 'html',
  CSS: 'css',
  JSON: 'json',
  JSX: 'javascript',
  TSX: 'typescript',
};

export function ModernMonacoEditor({
  file,
  theme,
  fontSize,
  onChange,
  onCursorChange,
  onSelectionChange,
}: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  // Trigger the loader.init once so the editor never blocks on a cold AMD load.
  useEffect(() => {
    configureMonacoOnce();
  }, []);

  const handleBeforeMount: BeforeMount = (monaco) => {
    // Register themes BEFORE the editor instantiates so its very first
    // paint uses catppuccin-mocha/latte — never the default vs-dark #1e1e1e.
    defineCatppuccinThemes(monaco);
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.setTheme(theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte');

    try {
      const diagOff = {
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      };
      monaco.languages.typescript?.typescriptDefaults?.setDiagnosticsOptions(diagOff);
      monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions(diagOff);
    } catch {
      /* ignore */
    }

    editor.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber, e.position.column);
    });

    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (!selection) return;
      const model = editor.getModel();
      if (model) onSelectionChange(model.getValueInRange(selection).length);
    });

    const container = editor.getContainerDomNode().parentElement;
    if (container) {
      const ro = new ResizeObserver(() => editor.layout());
      ro.observe(container);
      editor.onDidDispose(() => ro.disconnect());
    }
  };

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(
        theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte',
      );
    }
  }, [theme]);

  const languageId =
    LANGUAGE_MAP[file.language] || file.language?.toLowerCase() || 'plaintext';

  return (
    <div className="relative w-full h-full">
      <Editor
        height="100%"
        language={languageId}
        value={file.content}
        path={file.id}
        theme={theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte'}
        onChange={(v) => v !== undefined && onChange(v)}
        beforeMount={handleBeforeMount}
        onMount={handleEditorDidMount}
        loading={
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: theme === 'dark' ? '#232332' : '#EEF1F5' }}
          >
            <Loader2
              className={`animate-spin ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}
              size={24}
            />
          </div>
        }
        options={{
          automaticLayout: true,
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: true, showSlider: 'mouseover', renderCharacters: true },
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          roundedSelection: false,
          padding: { top: 16, bottom: 16 },
          bracketPairColorization: { enabled: true },
          renderLineHighlight: 'line',
          contextmenu: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          stickyScroll: { enabled: false },
        }}
      />
    </div>
  );
}
