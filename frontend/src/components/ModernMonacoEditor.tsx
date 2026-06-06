'use client';

import { useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import { StoredFile } from '@/services/storageService';
import { configureMonacoOnce } from '@/lib/monacoBootstrap';
import { defineCatppuccinThemes } from '@/lib/monacoThemes';
import {
  buildEditorOptions,
  toMonacoLanguageId,
} from '@/lib/monacoEditorConfig';

interface Props {
  file: StoredFile;
  theme: 'dark' | 'light';
  fontSize: number;
  onChange: (value: string) => void;
  onCursorChange: (ln: number, col: number) => void;
  onSelectionChange: (count: number) => void;
  onEditorReady?: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
}

export function ModernMonacoEditor({
  file,
  theme,
  fontSize,
  onChange,
  onCursorChange,
  onSelectionChange,
  onEditorReady,
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
    onEditorReady?.(editor);

    monaco.editor.setTheme(theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte');

    // Diagnostics are enabled globally in monacoBootstrap — no per-editor
    // overrides here. See configureLanguageDefaults() for the tuning.

    editor.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber, e.position.column);
    });

    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (!selection) return;
      const model = editor.getModel();
      if (model) onSelectionChange(model.getValueInRange(selection).length);
    });
  };

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(
        theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte',
      );
    }
  }, [theme]);

  const languageId = toMonacoLanguageId(file.language);

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
        options={buildEditorOptions(fontSize)}
      />
    </div>
  );
}
