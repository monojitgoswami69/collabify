'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import type * as Monaco from 'monaco-editor';
import { FileExplorer } from './FileExplorer';
import { CollabBar } from './CollabBar';
import { ChatPanel } from './ChatPanel';
import { Sash } from './Sash';
import { useSashResize } from '@/hooks/useSashResize';
import { StoredFile } from '@/services/storageService';
import { SharedFileInfo } from '@/services/collabService';
import { useTheme } from '@/hooks/useTheme';
import { detectLanguage, detectLanguageAI } from '@/utils/detectLanguage';
import {
  FileCode,
  Plus,
  Upload,
  Code2,
  FolderOpen,
  Sun,
  Moon,
  Users,
  X,
  MessageSquare,
  PanelRightClose,
  Menu,
} from 'lucide-react';
import {
  JavaScript,
  TypeScript,
  Python,
  CPlusPlus,
  C,
  Java,
  Go,
  RustDark,
  Ruby,
  PHP,
  GitHubDark,
  GitHubLight,
} from 'developer-icons';
import type { useCollabRoom } from '@/hooks/useCollabRoom';

// Dynamic import keeps Monaco out of the SSR/build path entirely.
const ModernMonacoEditor = dynamic(
  () => import('./ModernMonacoEditor').then((m) => m.ModernMonacoEditor),
  { ssr: false },
);

const CollabMonacoEditor = dynamic(
  () => import('./CollabMonacoEditor').then((m) => m.CollabMonacoEditor),
  { ssr: false },
);

const langIconMap: Record<string, { icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  JavaScript: { icon: JavaScript },
  TypeScript: { icon: TypeScript },
  Python: { icon: Python },
  'C++': { icon: CPlusPlus },
  C: { icon: C },
  Java: { icon: Java },
  Go: { icon: Go },
  Rust: { icon: RustDark },
  Ruby: { icon: Ruby },
  PHP: { icon: PHP },
};

function LanguageIcon({
  language,
  size = 16,
  className = '',
  colorOverride,
}: {
  language: string;
  size?: number;
  className?: string;
  colorOverride?: string;
}) {
  const entry = langIconMap[language];
  if (!entry) return <FileCode size={size} className={className} />;
  const Icon = entry.icon;
  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Icon size={size} color={colorOverride ? 'currentColor' : undefined} />
    </div>
  );
}

type CollabHook = ReturnType<typeof useCollabRoom>;

interface EditorViewProps {
  files: StoredFile[];
  activeFileId: string | null;
  loadingFileId: string | null;
  onFileSelect: (id: string) => void;
  onFileCreate: () => void;
  onFileDelete: (id: string) => void;
  onFileUpload: (file: File) => void;
  onCodeChange: (id: string, newCode: string) => void;
  onLanguageChange: (id: string, language: string) => void;
  onOpenGitHub: () => void;
  onOpenCollab: () => void;
  onRepoDelete?: (repoKey: string) => void;
  collab: CollabHook;
}

export function EditorView({
  files,
  activeFileId,
  loadingFileId,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileUpload,
  onCodeChange,
  onLanguageChange,
  onOpenGitHub,
  onOpenCollab,
  onRepoDelete,
  collab,
}: EditorViewProps) {
  const { isDark, toggleTheme } = useTheme();

  const activeFile = useMemo((): StoredFile | null => {
    if (!activeFileId) return null;
    const local = files.find((f) => f.id === activeFileId);
    if (local) return local;
    const shared = collab.sharedFiles.find((f) => f.id === activeFileId);
    if (shared) {
      return {
        id: shared.id,
        name: shared.name,
        language: shared.language,
        content: '',
        contentHash: '',
        lastModified: Date.now(),
      } as StoredFile;
    }
    return null;
  }, [activeFileId, files, collab.sharedFiles]);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ ln: 1, col: 1 });
  const [selectionCount, setSelectionCount] = useState(0);
  const [fontSize, setFontSize] = useState(16);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatWidthRef = useRef(0);
  const chatAnimationRef = useRef<number | null>(null);

  const editorLayoutFnRef = useRef<
    ((w: number, h: number, postponeRendering?: boolean) => void) | null
  >(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorLayout = useCallback(
    (width: number, height: number, postponeRendering = false) => {
      editorLayoutFnRef.current?.(Math.round(width), Math.round(height), postponeRendering);
    },
    [],
  );

  const handleResizeActiveChange = useCallback((active: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;

    if (active) {
      editor.updateOptions({
        wordWrapOverride1: 'off',
        wordWrapOverride2: 'off',
      });
      return;
    }

    editor.updateOptions({
      wordWrapOverride1: 'inherit',
      wordWrapOverride2: 'inherit',
    });

    const container = editorContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      editor.layout({ width: Math.round(rect.width), height: Math.round(rect.height) });
    } else {
      editor.layout();
    }
  }, []);

  const {
    sidebarWidth,
    rootRef,
    sidebarRef,
    editorContainerRef,
    handleResizeStart,
    handleResize,
    handleResizeEnd,
    setExternalResizeActive,
  } = useSashResize(handleEditorLayout, handleResizeActiveChange);

  const animateChatPanel = useCallback((open: boolean) => {
    const root = rootRef.current;
    const chatPanel = chatPanelRef.current;
    const editorContainer = editorContainerRef.current;
    if (!root || !chatPanel || !editorContainer) {
      setIsChatOpen(open);
      return;
    }

    if (chatAnimationRef.current !== null) {
      cancelAnimationFrame(chatAnimationRef.current);
      chatAnimationRef.current = null;
      setExternalResizeActive(false);
    }

    setIsChatOpen(open);
    setExternalResizeActive(true);
    handleResizeActiveChange(true);

    const startWidth = chatWidthRef.current;
    const endWidth = open ? 300 : 0;
    const duration = 200;
    const startedAt = performance.now();
    const rootWidth = root.clientWidth;
    const sidebarWidthNow = sidebarRef.current?.offsetWidth ?? sidebarWidth;
    const editorHeight = editorContainer.clientHeight;

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeOutCubic(progress);
      const width = startWidth + (endWidth - startWidth) * eased;
      chatWidthRef.current = width;

      chatPanel.style.width = `${width}px`;
      const editorWidth = rootWidth - sidebarWidthNow - width;
      if (editorWidth > 0 && editorHeight > 0) {
        handleEditorLayout(editorWidth, editorHeight, progress < 1);
      }

      if (progress < 1) {
        chatAnimationRef.current = requestAnimationFrame(step);
        return;
      }

      chatAnimationRef.current = null;
      setExternalResizeActive(false);
      handleResizeActiveChange(false);
    };

    chatAnimationRef.current = requestAnimationFrame(step);
  }, [
    handleEditorLayout,
    handleResizeActiveChange,
    rootRef,
    setExternalResizeActive,
    sidebarRef,
    sidebarWidth,
  ]);

  const handleEditorReady = useCallback(
    (ed: Monaco.editor.IStandaloneCodeEditor) => {
      editorRef.current = ed;
      editorLayoutFnRef.current = (w, h, postponeRendering = false) =>
        ed.layout({ width: w, height: h }, postponeRendering);
      
      // Trigger an initial layout calculation using Monaco's internal DOM reader
      ed.layout();
    },
    [],
  );



  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem('editor-font-size');
    if (saved) setFontSize(parseInt(saved, 10));
  }, []);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('editor-font-size', fontSize.toString());
  }, [fontSize]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Status-bar coalescing — Monaco fires onDidChangeCursorPosition /
  // Selection on every micro-movement (during a click-drag selection that's
  // 100+ fires/sec). VSCode batches its statusBar updates via interval;
  // we use rAF, which keeps the bar at one repaint/frame max. The pending
  // value lives in a ref and only one setState/frame is flushed.
  const pendingCursorRef = useRef({ ln: 1, col: 1 });
  const pendingSelectionRef = useRef(0);
  const statusRafRef = useRef(0);
  const flushStatus = useCallback(() => {
    statusRafRef.current = 0;
    setCursorPosition({ ...pendingCursorRef.current });
    setSelectionCount(pendingSelectionRef.current);
  }, []);
  const scheduleStatusFlush = useCallback(() => {
    if (statusRafRef.current) return;
    statusRafRef.current = requestAnimationFrame(flushStatus);
  }, [flushStatus]);
  const handleCursorChange = useCallback(
    (ln: number, col: number) => {
      const prev = pendingCursorRef.current;
      if (prev.ln === ln && prev.col === col) return;
      pendingCursorRef.current = { ln, col };
      scheduleStatusFlush();
    },
    [scheduleStatusFlush],
  );
  const handleSelectionChange = useCallback(
    (count: number) => {
      if (pendingSelectionRef.current === count) return;
      pendingSelectionRef.current = count;
      scheduleStatusFlush();
    },
    [scheduleStatusFlush],
  );
  useEffect(() => {
    return () => {
      if (statusRafRef.current) cancelAnimationFrame(statusRafRef.current);
      if (chatAnimationRef.current !== null) {
        cancelAnimationFrame(chatAnimationRef.current);
        setExternalResizeActive(false);
      }
    };
  }, [setExternalResizeActive]);

  useEffect(() => {
    pendingCursorRef.current = { ln: 1, col: 1 };
    pendingSelectionRef.current = 0;
    setCursorPosition({ ln: 1, col: 1 });
    setSelectionCount(0);
  }, [activeFileId]);

  // Two-tier language detection:
  //   1. Sync extension lookup — runs on every active-file change. Cheap.
  //   2. Async Magika WASM — debounced 750ms. Magika is content-based so it
  //      can re-classify as the user types, but we don't need to spin the
  //      WASM up on every keystroke. 750ms matches the threshold used by
  //      VSCode's "auto-detect language" (workbench.editor.languageDetection).
  useEffect(() => {
    if (!activeFile) return;
    if (activeFile.language) return; // already classified — no work

    // Sync pass — fire immediately, no debounce.
    const syncLang = detectLanguage(activeFile.name, activeFile.content);
    if (syncLang) onLanguageChange(activeFile.id, syncLang);

    // Async pass — only when there's enough content to be worth running
    // the model. Debounced so rapid typing collapses to one classification.
    if (!activeFile.content || activeFile.content.trim().length <= 20) return;

    const fileId = activeFile.id;
    const fileName = activeFile.name;
    const content = activeFile.content;
    const timer = setTimeout(() => {
      detectLanguageAI(fileName, content)
        .then((aiLang) => {
          if (aiLang && aiLang !== syncLang) onLanguageChange(fileId, aiLang);
        })
        .catch(() => {});
    }, 750);
    return () => clearTimeout(timer);
  }, [activeFile?.id, activeFile?.language, activeFile?.name, activeFile?.content, onLanguageChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUploadInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Suppress unused warning when fontSize setter isn't directly invoked.
  void setFontSize;

  const isInRoom =
    collab.status === 'connected' ||
    collab.status === 'waiting-approval' ||
    collab.status === 'connecting';

  useEffect(() => {
    if (!isInRoom) {
      chatWidthRef.current = 0;
      setIsChatOpen(false);
    }
  }, [isInRoom]);

  const sharedFileIds = useMemo(
    () => new Set(collab.sharedFiles.map((f) => f.id)),
    [collab.sharedFiles],
  );

  const isActiveFileShared = activeFileId ? sharedFileIds.has(activeFileId) : false;

  const collabFileContents = useMemo(() => {
    const m = new Map<string, StoredFile>();
    for (const sf of collab.sharedFiles) {
      const local = files.find((f) => f.id === sf.id);
      if (local) m.set(sf.id, local);
    }
    return m;
  }, [collab.sharedFiles, files]);

  const handleAddToCollab = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    collab.shareFile({
      id: file.id,
      name: file.name,
      language: file.language,
      content: file.content,
    });
  };

  const handleRemoveFromCollab = (fileId: string) => {
    collab.unshareFile(fileId);
  };

  const handleSelectCollabFile = (fileId: string) => {
    onFileSelect(fileId);
  };

  const handleReorderCollabFiles = (newOrder: SharedFileInfo[]) => {
    collab.reorderFiles(newOrder);
  };

  const bg = isDark ? 'bg-[#1E1E2A]' : 'bg-[#E5E8EE]';
  const bgEditor = isDark ? 'bg-[#232332]' : 'bg-[#EEF1F5]';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';

  return (
    <div className={`flex flex-col h-screen ${bgEditor} text-slate-300 overflow-hidden`}>
      <header
        className={`h-14 flex items-center justify-between px-4 ${isDark ? 'bg-[#181821]' : 'bg-[#DBDFE7]'} z-20 shadow-xs border-b ${isDark ? 'border-slate-800/50' : 'border-slate-300/50'}`}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className={`md:hidden p-1.5 rounded-lg transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200'}`}
            aria-label="Open Sidebar"
          >
            <Menu size={20} />
          </button>
          <Image
            src="/CodeCollab-logo.png"
            alt="Collabify Logo"
            width={40}
            height={40}
            className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
            priority
          />
          <span
            className={`hidden sm:inline font-black tracking-tighter quantico-font text-[24px] sm:text-[28px] ${textPrimary} select-none`}
          >
            Collabify
          </span>
          <button
            onClick={toggleTheme}
            className={`relative flex items-center justify-center w-8 h-8 ml-1 transition-colors ${isDark ? 'text-slate-400 hover:text-amber-300' : 'text-slate-500 hover:text-blue-500'}`}
            aria-label="Toggle Theme"
          >
            <Sun
              size={20}
              className={`absolute transition-all duration-500 ease-in-out ${isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 -rotate-90 opacity-0'}`}
            />
            <Moon
              size={20}
              className={`absolute transition-all duration-500 ease-in-out ${isDark ? 'scale-0 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isInRoom && collab.roomId && (
            <CollabBar
              roomId={collab.roomId}
              status={collab.status}
              isHost={collab.isHost}
              isLocked={collab.isLocked}
              members={collab.members}
              pending={collab.pending}
              onApprove={collab.approveJoin}
              onReject={collab.rejectJoin}
              onLeave={collab.leaveRoom}
              onKick={collab.kickMember}
              onLockRoom={collab.lockRoom}
            />
          )}
          {isInRoom && (
            <button
              onClick={() => animateChatPanel(!isChatOpen)}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
                isChatOpen
                  ? isDark
                    ? 'bg-[#CAA4F7]/20 text-[#CAA4F7]'
                    : 'bg-[#CAA4F7]/15 text-[#9B6DD7]'
                  : isDark
                    ? 'text-slate-400 hover:bg-slate-700/50 hover:text-[#CAA4F7]'
                    : 'text-slate-500 hover:bg-slate-200 hover:text-[#9B6DD7]'
              }`}
              title={isChatOpen ? 'Close Chat' : 'Open Chat'}
            >
              {isChatOpen ? <PanelRightClose size={18} /> : <MessageSquare size={18} />}
            </button>
          )}
          {!isInRoom && (
            <button
              onClick={onOpenCollab}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#CAA4F7]/15 hover:bg-[#CAA4F7]/25 text-[#CAA4F7] text-xs font-bold transition-all active:scale-95 border border-[#CAA4F7]/20"
            >
              <Users size={14} /> Collab
            </button>
          )}
        </div>
      </header>

      {/* Main content — CSS Grid layout.
           Desktop columns: [sidebar: var(--sidebar-w)] [editor: 1fr] [chat: 0px or 300px]
           The chat column width is interpolated by the browser's grid engine which avoids
           JS-driven width animation (which triggers layout reflow every frame).
           Mobile: sidebar is fixed-overlay, grid is [editor: 1fr] [chat: 0 or 300px]. */}
      <div
        ref={rootRef}
        className="flex-1 min-h-0 overflow-hidden relative flex flex-row"
      >
        {/* Mobile sidebar backdrop — no backdrop-blur (GPU-heavy) */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar — fixed overlay on mobile (with transform transition),
            relative grid cell on desktop (no transition, width via CSS var). */}
        <div
          ref={sidebarRef}
          className={`fixed md:relative inset-y-0 left-0 z-50 flex flex-col ${bg} border-r ${isDark ? 'border-slate-800/50' : 'border-slate-300/50'} md:border-r-0 transition-transform duration-200 ease-out md:transition-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 will-change-transform md:will-change-auto shrink-0`}
          style={{
            width: `${sidebarWidth}px`,
            minWidth: `${sidebarWidth}px`,
          }}
        >
          <div
            className={`flex md:hidden items-center justify-between px-4 py-3 border-b ${isDark ? 'border-slate-800/50' : 'border-slate-300/50'}`}
          >
            <span className={`font-bold ${textPrimary}`}>Files</span>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className={`p-1.5 rounded-md ${textMuted} hover:bg-red-500/10 hover:text-red-500 transition-colors`}
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-2 pt-4 pb-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={onFileCreate}
                className="flex-1 flex items-center justify-center gap-2 bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] py-2.5 rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95"
              >
                <Plus size={14} /> New Snippet
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center px-3 rounded-lg bg-[#CAA4F7]/20 hover:bg-[#CAA4F7]/30 text-[#CAA4F7] border border-[#CAA4F7]/30 transition-all active:scale-95 shadow-xs"
                title="Upload File"
              >
                <Upload size={14} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".js,.ts,.jsx,.tsx,.py,.cpp,.c,.java,.go,.rs,.rb,.php,.html,.css,.json,.md,.yaml,.yml,.xml,.sh,.sql"
                onChange={handleFileUploadInput}
              />
            </div>
            <button
              onClick={onOpenGitHub}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all border ${isDark ? 'bg-[#232340] hover:bg-[#2a2a50] text-slate-300 border-slate-700/50 hover:border-purple-500/50' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300 hover:border-purple-400'} active:scale-[0.98] shadow-xs`}
            >
              {isDark ? <GitHubLight size={14} /> : <GitHubDark size={14} />} Import from GitHub
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar">
            {files.length === 0 && !(isInRoom && collab.sharedFiles.length > 0) ? (
              <div className={`flex flex-col items-center justify-center h-full py-8 ${textMuted}`}>
                <FolderOpen size={28} className="mb-3 opacity-50" />
                <p className="text-xs text-center">No snippets yet</p>
              </div>
            ) : (
              <FileExplorer
                files={files}
                activeFileId={activeFileId}
                loadingFileId={loadingFileId}
                onFileSelect={onFileSelect}
                onFileDelete={onFileDelete}
                onRepoDelete={onRepoDelete}
                isInRoom={isInRoom}
                isHost={collab.isHost}
                sharedFiles={collab.sharedFiles}
                collabFileContents={collabFileContents}
                onAddToCollab={handleAddToCollab}
                onRemoveFromCollab={handleRemoveFromCollab}
                onSelectCollabFile={handleSelectCollabFile}
                onReorderCollabFiles={handleReorderCollabFiles}
              />
            )}
          </div>

          <div className="absolute top-0 right-0 h-full z-50 hidden md:block">
            <Sash
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          </div>
        </div>

        {/* Editor area */}
        <div
          ref={editorContainerRef}
          className="flex flex-col min-w-0 flex-1 overflow-hidden relative"
        >
          {!activeFile ? (
            <div className={`flex-1 flex flex-col items-center justify-center ${bgEditor}`}>
              <div className="text-center max-w-md px-8">
                <FolderOpen
                  size={48}
                  className={`mx-auto mb-8 ${isDark ? 'text-blue-400/50' : 'text-blue-500/50'}`}
                />
                <h2 className={`text-xl font-semibold mb-2 ${textPrimary}`}>Welcome to Collabify</h2>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={onFileCreate}
                    className="flex items-center gap-2 px-6 py-3 bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] rounded-lg text-sm font-medium transition-colors shadow-md"
                  >
                    <Plus size={18} /> New Snippet
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="flex-1 relative overflow-hidden"
              // `contain: layout paint style` isolates Monaco from the
              // browser's reflow cascade. Without it, every container resize
              // forces the whole document to relayout; the editor's own
              // layout pass then changes scrollbar/wrap geometry, which the
              // outer layout sees and queues another reflow — the "rapidly
              // fitting into place" loop. With containment, Monaco's
              // internals stay a self-contained layer that the browser can
              // resize and composite without re-running outer layout, which
              // is the single biggest win for resize latency.
              style={{ contain: 'layout paint style' }}
            >
              {collab.status === 'waiting-approval' && (
                <div
                  className={`absolute inset-0 z-10 flex flex-col items-center justify-center ${isDark ? 'bg-[#232332]/90' : 'bg-[#EEF1F5]/90'} backdrop-blur-xs`}
                >
                  <div className="mb-4">
                    <Users size={32} className="text-[#CAA4F7]" />
                  </div>
                  <p className={`text-sm font-medium ${textPrimary}`}>
                    Waiting for host approval...
                  </p>
                  <p className={`text-xs mt-1 ${textMuted}`}>
                    The room host will accept or reject your request.
                  </p>
                  <button
                    onClick={collab.leaveRoom}
                    className="mt-4 px-4 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-bold hover:bg-red-500/25 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isActiveFileShared && collab.provider && collab.status === 'connected' ? (
                <CollabMonacoEditor
                  file={activeFile}
                  theme={isDark ? 'dark' : 'light'}
                  fontSize={fontSize}
                  provider={collab.provider}
                  onChange={(code) => onCodeChange(activeFile.id, code)}
                  onCursorChange={handleCursorChange}
                  onSelectionChange={handleSelectionChange}
                  onEditorReady={handleEditorReady}
                />
              ) : (
                <ModernMonacoEditor
                  file={activeFile}
                  theme={isDark ? 'dark' : 'light'}
                  fontSize={fontSize}
                  onChange={(code) => onCodeChange(activeFile.id, code)}
                  onCursorChange={handleCursorChange}
                  onSelectionChange={handleSelectionChange}
                  onEditorReady={handleEditorReady}
                />
              )}
            </div>
          )}
        </div>

        {/* Chat panel — sits in the 3rd grid column (0px when closed, 300px when open).
            The grid-template-columns transition handles the animation;
            overflow:hidden on this cell clips content during the transition. */}
        {isInRoom && (
          <div
            ref={chatPanelRef}
            className="overflow-hidden shrink-0"
            style={{
              width: `${chatWidthRef.current}px`,
            }}
          >
            <ChatPanel
              isOpen={isChatOpen}
              messages={collab.chatMessages}
              selfPeerId={collab.peerId}
              onSendMessage={collab.sendChatMessage}
              onClose={() => setIsChatOpen(false)}
            />
          </div>
        )}
      </div>

      <div
        className={`h-8 flex items-center justify-between px-2 sm:px-4 text-[10px] sm:text-[12px] kode-font font-black ${isDark ? 'bg-[#181821] text-white/70' : 'bg-[#DBDFE7] text-slate-500/30'} relative`}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 h-4">
            <FileCode size={14} className="hidden sm:block" />
            <span>{files.length} FILES</span>
          </div>
          {activeFile && (
            <div className="flex items-center animate-fade-in">
              <div
                className={`flex items-center gap-2 h-6 transition-colors ${isDark ? 'text-white/70' : 'text-slate-500/30'}`}
              >
                <LanguageIcon
                  language={activeFile.language}
                  size={14}
                  colorOverride="text-current opacity-70"
                />
                <span>
                  {activeFile.language ? activeFile.language.toUpperCase() : 'AUTO DETECTING...'}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeFile && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 h-4">
                <Code2 size={14} className="hidden sm:block" />
                <span>
                  LN {cursorPosition.ln}, COL {cursorPosition.col}{' '}
                  <span className="hidden sm:inline">
                    {selectionCount > 0 && `(${selectionCount} selected)`}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {collab.toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-100 flex flex-col gap-2 pointer-events-none">
          {collab.toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 min-w-[280px] max-w-[400px] rounded-md shadow-lg text-[12px] font-medium transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                toast.exiting
                  ? 'opacity-0 translate-x-4 scale-100'
                  : 'animate-[slideInRight_0.35s_cubic-bezier(0.2,0.8,0.2,1)_forwards] opacity-100 translate-x-0 scale-100'
              } ${
                toast.type === 'error'
                  ? 'bg-[#bf616a] text-[#eceff4] border border-[#bf616a]/50'
                  : toast.type === 'success'
                    ? 'bg-[#a3be8c] text-[#2e3440] border border-[#a3be8c]/50'
                    : toast.type === 'warning'
                      ? 'bg-[#ebcb8b] text-[#2e3440] border border-[#ebcb8b]/50'
                      : isDark
                        ? 'bg-[#3b4252] text-[#eceff4] border border-[#4c566a]'
                        : 'bg-[#eceff4] text-[#2e3440] border border-[#d8dee9]'
              }`}
            >
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                onClick={() => collab.dismissToast(toast.id)}
                className="shrink-0 ml-2 opacity-60 hover:opacity-100 transition-all p-1 rounded-sm hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
