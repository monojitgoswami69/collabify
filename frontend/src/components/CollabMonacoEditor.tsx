'use client';

// CollabMonacoEditor — Monaco bound to a per-file Yjs DocConnection.

import { useRef, useEffect, useState } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import { Loader2 } from 'lucide-react';
import { StoredFile } from '@/services/storageService';
import { CollabProvider } from '@/services/collabService';
import { configureMonacoOnce } from '@/lib/monacoBootstrap';
import { defineCatppuccinThemes } from '@/lib/monacoThemes';
import {
  buildEditorOptions,
  observeEditorLayout,
  toMonacoLanguageId,
} from '@/lib/monacoEditorConfig';
import { syncPeerCursors, clearAllPeers } from '@/lib/peerCursorStyles';

interface Props {
  file: StoredFile;
  theme: 'dark' | 'light';
  fontSize: number;
  provider: CollabProvider;
  onChange: (value: string) => void;
  onCursorChange: (ln: number, col: number) => void;
  onSelectionChange: (count: number) => void;
}

export function CollabMonacoEditor({
  file,
  theme,
  fontSize,
  provider,
  onCursorChange,
  onSelectionChange,
}: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  useEffect(() => {
    configureMonacoOnce();
  }, []);

  // Bind Monaco to the Y.Doc once the editor is mounted AND the provider is
  // connected. Owns the lifecycle of the binding + peer cursor sync.
  const providerStatus = provider.status;
  useEffect(() => {
    if (!editorReady || providerStatus !== 'connected') return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;

    const docConn = provider.openFileConnection(file.id);
    const ytext = docConn.doc.getText('monaco');
    const binding = new MonacoBinding(ytext, model, new Set([editor]), docConn.awareness);
    bindingRef.current = binding;

    const localId = docConn.doc.clientID;
    const syncCursorDecorations = () => {
      syncPeerCursors(
        docConn.awareness.getStates() as Map<number, { user?: { name?: string; color?: string } }>,
        localId,
      );
    };

    syncCursorDecorations();
    docConn.awareness.on('change', syncCursorDecorations);

    return () => {
      docConn.awareness.off('change', syncCursorDecorations);
      // Drop styles for peers we were rendering; if another collab editor
      // is mounted on the page, its next awareness tick will re-add them.
      clearAllPeers();
      binding.destroy();
      bindingRef.current = null;
    };
    // `provider` reference is stable across renders (held in React state via
    // useCollabRoom); status is what flips, so list it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorReady, providerStatus, file.id]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    // Register themes BEFORE the editor instantiates so its very first
    // paint uses catppuccin-mocha/latte — never the default vs-dark #1e1e1e.
    defineCatppuccinThemes(monaco);
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.setTheme(theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte');

    // Diagnostics enabled globally in monacoBootstrap — no per-editor overrides.

    editor.onDidChangeCursorPosition((e) =>
      onCursorChange(e.position.lineNumber, e.position.column),
    );

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (!sel) return;
      const model = editor.getModel();
      if (model) onSelectionChange(model.getValueInRange(sel).length);
    });

    observeEditorLayout(editor);

    setEditorReady(true);
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
        defaultValue=""
        path={`collab/${file.id}`}
        theme={theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte'}
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
