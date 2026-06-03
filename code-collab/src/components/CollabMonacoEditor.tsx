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

interface Props {
  file: StoredFile;
  theme: 'dark' | 'light';
  fontSize: number;
  provider: CollabProvider;
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

// ─── Global cursor CSS (injected once per session) ─────────────────────
let globalStylesInjected = false;
function ensureGlobalCursorStyles() {
  if (globalStylesInjected || typeof document === 'undefined') return;
  globalStylesInjected = true;
  const el = document.createElement('style');
  el.id = 'yRemoteCursorGlobals';
  el.textContent = `
    .yRemoteSelectionHead::before {
      content: '';
      position: absolute;
      top: 0;
      left: -10px;
      width: 24px;
      height: 100%;
      cursor: default;
      z-index: 99;
    }
    .yRemoteSelectionHead::after {
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
    }
    .yRemoteSelectionHead:hover::after {
      opacity: 1;
    }
  `;
  document.head.appendChild(el);
}

function injectCursorStyles(clientID: number, color: string, name: string) {
  const styleId = `yRemoteCursor-${clientID}`;
  if (document.getElementById(styleId)) return;
  ensureGlobalCursorStyles();

  const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const el = document.createElement('style');
  el.id = styleId;
  el.textContent = `
    .yRemoteSelection-${clientID} {
      background-color: ${color}20 !important;
    }
    .yRemoteSelectionHead-${clientID} {
      position: absolute;
      border-left: 2px solid ${color} !important;
      box-sizing: border-box;
      height: 100% !important;
    }
    .yRemoteSelectionHead-${clientID}::after {
      content: '${escapedName}';
      position: absolute;
      color: #fff;
      background-color: ${color};
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 6px 3px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      bottom: 100%;
      left: -2px;
      z-index: 100;
    }
  `;
  document.head.appendChild(el);
}

function removeCursorStyles(clientID: number) {
  document.getElementById(`yRemoteCursor-${clientID}`)?.remove();
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
  const injectedRef = useRef<Set<number>>(new Set());
  const [editorReady, setEditorReady] = useState(false);

  useEffect(() => {
    configureMonacoOnce();
  }, []);

  // Bind Monaco to the Y.Doc once the editor is mounted AND the provider is
  // connected. Owns the lifecycle of the binding + cursor decorations.
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

    const injected = injectedRef.current;
    const syncCursorDecorations = () => {
      const states = docConn.awareness.getStates();
      const localId = docConn.doc.clientID;
      states.forEach((state, clientID) => {
        if (clientID === localId || injected.has(clientID)) return;
        const user = (state as { user?: { name?: string; color?: string } }).user;
        if (user?.color && user?.name) {
          injectCursorStyles(clientID, user.color, user.name);
          injected.add(clientID);
        }
      });
      // Drop styles for peers that no longer exist. `states.has` is O(1),
      // so we avoid allocating a snapshot Set per awareness tick.
      for (const id of injected) {
        if (!states.has(id)) {
          removeCursorStyles(id);
          injected.delete(id);
        }
      }
    };

    syncCursorDecorations();
    docConn.awareness.on('change', syncCursorDecorations);

    return () => {
      docConn.awareness.off('change', syncCursorDecorations);
      injected.forEach((id) => removeCursorStyles(id));
      injected.clear();
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

    editor.onDidChangeCursorPosition((e) =>
      onCursorChange(e.position.lineNumber, e.position.column),
    );

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (!sel) return;
      const model = editor.getModel();
      if (model) onSelectionChange(model.getValueInRange(sel).length);
    });

    const container = editor.getContainerDomNode().parentElement;
    if (container) {
      const ro = new ResizeObserver(() => editor.layout());
      ro.observe(container);
      editor.onDidDispose(() => ro.disconnect());
    }

    setEditorReady(true);
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
