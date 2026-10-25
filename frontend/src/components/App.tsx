'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { EditorView } from './EditorView';
import { ThemeProvider } from '@/hooks/useTheme';
import { useCollabRoom } from '@/hooks/useCollabRoom';
import { useAgent } from '@/hooks/useAgent';
import { GitHubImportModal } from './GitHubImportModal';
import { CollabRoomModal } from './CollabRoomModal';
import {
  getStoredFiles,
  saveFiles,
  getActiveFileId,
  setActiveFileId as saveActiveFileId,
  newFileId,
  StoredFile,
} from '@/services/storageService';
import type { AgentWorkspaceContext } from '@/lib/agentTools';
import { detectLanguage, detectLanguageAI } from '@/utils/detectLanguage';
import {
  fetchRawContent,
  getStoredToken,
  GitHubRepo,
  RepoTreeItem,
} from '@/services/githubService';

// useLayoutEffect runs synchronously after DOM mutations but before browser paint.
// On the server it would warn — so fall back to useEffect there. This lets us read
// localStorage during hydration commit and avoid a "no snippets" flash on refresh.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function AppInner() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  // Mirrors loadingFileId for guards inside async callbacks without re-creating them.
  const loadingFileIdRef = useRef<string | null>(null);

  const collab = useCollabRoom();
  const autoSharedRef = useRef(false);
  // `files`, `activeFileId`, and `collab.shareFile` are needed inside an
  // effect that should not re-run on every keystroke. Latest-ref pattern.
  const filesRef = useRef(files);
  const activeFileIdRef = useRef(activeFileId);
  const shareFileRef = useRef(collab.shareFile);
  const collabRef = useRef(collab);
  const sharedFileIdsRef = useRef<Set<string>>(new Set());
  const handleCodeChangeRef = useRef<((id: string, code: string) => void) | null>(null);
  const handleFileDeleteRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    filesRef.current = files;
    activeFileIdRef.current = activeFileId;
    shareFileRef.current = collab.shareFile;
    collabRef.current = collab;
    sharedFileIdsRef.current = new Set(collab.sharedFiles.map((f) => f.id));
    agentWorkspaceRef.current = {
      files,
      activeFileId,
      provider: collab.provider,
      collabConnected: collab.status === 'connected',
      sharedFileIds: sharedFileIdsRef.current,
      applyContent: (fileId, content) => handleCodeChangeRef.current?.(fileId, content),
      addFile: (file) => setFiles((prev) => [...prev, file]),
      removeFile: (fileId) => handleFileDeleteRef.current?.(fileId),
      setActive: (fileId) => setActiveFileId(fileId),
    };
  });

  // ── AI agent ─────────────────────────────────────────────────────────
  // The agent's tools operate on live workspace state, read fresh at call
  // time through this ref (latest-ref pattern, like the ones above).
  const agentWorkspaceRef = useRef<AgentWorkspaceContext>({
    files: [],
    activeFileId: null,
    provider: null,
    collabConnected: false,
    sharedFileIds: new Set<string>(),
    applyContent: () => {},
    addFile: () => {},
    removeFile: () => {},
    setActive: () => {},
  });
  const agent = useAgent({ getWorkspace: () => agentWorkspaceRef.current! });

  const { isHost: collabIsHost, status: collabStatus } = collab;
  const sharedCount = collab.sharedFiles.length;
  useEffect(() => {
    if (collabStatus !== 'connected') {
      // Reset on every non-connected status (not just 'disconnected') so a
      // failed room doesn't suppress auto-share in the next one.
      autoSharedRef.current = false;
      return;
    }
    if (
      collabIsHost &&
      sharedCount === 0 &&
      !autoSharedRef.current
    ) {
      const activeId = activeFileIdRef.current;
      const file = activeId ? filesRef.current.find((f) => f.id === activeId) : null;
      // Never auto-share an unloaded repo file — it would seed the room with
      // an empty document the host's real content never reaches.
      if (file && file.contentLoaded !== false) {
        autoSharedRef.current = true;
        shareFileRef.current({
          id: file.id,
          name: file.name,
          language: file.language,
          content: file.content,
        });
      }
    }
    // `files` in deps so a deferred auto-share (unloaded file) can fire once
    // the content loads; the ref guard keeps the per-render cost at a check.
  }, [collabIsHost, collabStatus, sharedCount, files]);

  useEffect(() => {
    if (
      showCollabModal &&
      (collab.status === 'waiting-approval' || collab.status === 'connected')
    ) {
      setShowCollabModal(false);
    }
  }, [collab.status, showCollabModal]);

  // For non-host peers: when joining a room with shared files, if the user
  // has no active selection (or their selection isn't part of the room),
  // auto-open the first shared file so they immediately see live content.
  const firstSharedId = collab.sharedFiles[0]?.id ?? null;
  useEffect(() => {
    if (collabStatus !== 'connected' || collabIsHost || !firstSharedId) return;
    const activeIsShared =
      activeFileId !== null && collab.sharedFiles.some((f) => f.id === activeFileId);
    if (!activeIsShared) setActiveFileId(firstSharedId);
    // `collab.sharedFiles` intentionally omitted: we only care when the first
    // shared file appears or the active selection moves outside the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabStatus, collabIsHost, firstSharedId, activeFileId]);

  useIsomorphicLayoutEffect(() => {
    const stored = getStoredFiles();
    const storedActive = getActiveFileId();
    hydratedFilesRef.current = stored;
    setFiles(stored);
    if (stored.length > 0) {
      const active =
        storedActive && stored.some((f) => f.id === storedActive)
          ? storedActive
          : stored[0].id;
      setActiveFileId(active);
    }
    setIsInitialized(true);
  }, []);

  // The exact array hydrated from storage — a save of this unchanged value
  // would be a no-op at best and, when the stored JSON was corrupt (fallback
  // []), would overwrite whatever might still be recoverable. Skip it.
  const hydratedFilesRef = useRef<StoredFile[] | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (hydratedFilesRef.current === files) return; // untouched since load
    const handler = setTimeout(() => {
      saveFiles(files);
    }, 500);
    return () => clearTimeout(handler);
  }, [files, isInitialized]);

  const lastSavedFilesRef = useRef(files);
  useEffect(() => {
    lastSavedFilesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!isInitialized) return;
    const handleBeforeUnload = () => {
      // Same invariant as the debounced save: never write back the exact
      // array hydrated from storage — if it was corrupt (fallback []),
      // persisting it would destroy what might still be recoverable.
      if (lastSavedFilesRef.current !== hydratedFilesRef.current) {
        saveFiles(lastSavedFilesRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInitialized]);

  useEffect(() => {
    if (isInitialized && activeFileId) saveActiveFileId(activeFileId);
  }, [activeFileId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    let active = true;
    let cleanup: (() => void) | undefined;

    const loadMagikaAfterEverything = async () => {
      try {
        // Dynamically import configureMonacoOnce to avoid static dependency in App.tsx (SSR-safe)
        const { configureMonacoOnce, preloadLanguageWorkers } = await import('@/lib/monacoBootstrap');

        // Wait for Monaco to be configured/loaded
        await configureMonacoOnce();

        if (!active) return;

        // Spin up TS/JS workers on idle so the first edit doesn't pay the
        // worker-instantiation cost (same pattern Magika preload uses).
        preloadLanguageWorkers();

        const preloadMagika = async () => {
          if (!active) return;
          const { preloadMagikaModel } = await import('@/utils/detectLanguage');
          preloadMagikaModel();
        };

        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(preloadMagika);
        } else {
          setTimeout(preloadMagika, 1500);
        }
      } catch (err) {
        console.error('Failed to lazy load Monaco/Magika in background', err);
      }
    };

    // Wait for the window load event to guarantee all other components are fully loaded
    if (document.readyState === 'complete') {
      loadMagikaAfterEverything();
    } else {
      const listener = () => {
        loadMagikaAfterEverything();
      };
      window.addEventListener('load', listener);
      cleanup = () => {
        window.removeEventListener('load', listener);
      };
    }

    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, [isInitialized]);

  const handleFileCreate = useCallback(() => {
    const newFile: StoredFile = {
      id: newFileId(),
      name: `Snippet-${files.length + 1}`,
      content: '',
      language: '',
      lastModified: Date.now(),
    };
    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(newFile.id);
  }, [files.length]);

  const handleFileUpload = useCallback(async (file: File) => {
    const text = await file.text();
    const fileId = newFileId();
    const syncLanguage = detectLanguage(file.name, text);
    const newFile: StoredFile = {
      id: fileId,
      name: file.name,
      content: text,
      language: syncLanguage,
      lastModified: Date.now(),
    };
    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(fileId);
    detectLanguageAI(file.name, text).then((aiLang) => {
      if (aiLang && aiLang !== syncLanguage) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, language: aiLang } : f)));
      }
    });
  }, []);

  const handleFileDelete = useCallback(
    (id: string) => {
      // Compute the next state outside the updater — React updaters must be
      // pure (React 19 may invoke them twice under StrictMode).
      const prev = filesRef.current;
      const next = prev.filter((f) => f.id !== id);
      if (next.length === prev.length) return;
      setFiles(next);
      if (activeFileIdRef.current === id) {
        setActiveFileId(next.length > 0 ? next[0]!.id : null);
      }
      // Unshare from the collab room if this file is shared — otherwise it
      // lingers as an editable ghost backed by nothing (same invariant as
      // repo delete).
      if (sharedFileIdsRef.current.has(id)) collabRef.current.unshareFile(id);
      // Dispose the Monaco text model so we don't leak its buffer +
      // tokenization cache. Lazy import keeps monaco out of the SSR path.
      import('@/lib/monacoModels')
        .then(({ disposeModelsForFile }) => disposeModelsForFile(id))
        .catch(() => {});
    },
    [],
  );

  const handleCodeChange = useCallback((id: string, newCode: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              content: newCode,
              lastModified: Date.now(),
            }
          : f,
      ),
    );
  }, []);

  handleCodeChangeRef.current = handleCodeChange;
  handleFileDeleteRef.current = handleFileDelete;

  const handleLanguageChange = useCallback((id: string, language: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, language, lastModified: Date.now() } : f)),
    );
  }, []);

  const handleGitHubImport = useCallback((fileName: string, content: string, language: string) => {
    const fileId = newFileId();
    const newFile: StoredFile = {
      id: fileId,
      name: fileName,
      content,
      language,
      lastModified: Date.now(),
      contentLoaded: true,
    };
    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(fileId);
    detectLanguageAI(fileName, content).then((aiLang) => {
      if (aiLang && aiLang !== language) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, language: aiLang } : f)));
      }
    });
  }, []);

  const handleRepoImport = useCallback((repo: GitHubRepo, tree: RepoTreeItem[]) => {
    const fileEntries = tree.filter((item) => item.type === 'blob');
    const newFiles: StoredFile[] = fileEntries.map((item, i) => {
      const fileName = item.path.split('/').pop() || item.path;
      return {
        id: `${newFileId()}-${i}`,
        name: fileName,
        content: '',
        language: detectLanguage(fileName, ''),
        lastModified: Date.now(),
        path: item.path,
        repoOrigin: {
          owner: repo.owner.login,
          repo: repo.name,
          branch: repo.default_branch,
        },
        contentLoaded: false,
      };
    });
    setFiles((prev) => [...prev, ...newFiles]);
    if (newFiles.length > 0) setActiveFileId(newFiles[0].id);
  }, []);

  const handleFileSelect = useCallback(
    async (id: string) => {
      setActiveFileId(id);
      // In-flight guard: a second click on the same loading file (or on
      // another file while one loads) must not stack duplicate fetches.
      const loadingRef = loadingFileIdRef.current;
      if (loadingRef === id) return;
      const file = filesRef.current.find((f) => f.id === id);
      if (file && file.repoOrigin && !file.contentLoaded) {
        loadingFileIdRef.current = id;
        setLoadingFileId(id);
        try {
          const token = getStoredToken();
          const content = await fetchRawContent(
            file.repoOrigin.owner,
            file.repoOrigin.repo,
            file.repoOrigin.branch,
            file.path || file.name,
            token,
          );
          const syncLang = detectLanguage(file.name, content);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id
                ? {
                    ...f,
                    content,
                    language: syncLang,
                    contentLoaded: true,
                  }
                : f,
            ),
          );
          detectLanguageAI(file.name, content).then((aiLang) => {
            if (aiLang && aiLang !== syncLang) {
              setFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, language: aiLang } : f)),
              );
            }
          });
        } catch (err) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id
                ? {
                    ...f,
                    content: `// Error loading file: ${(err as Error).message}`,
                    contentLoaded: true,
                  }
                : f,
            ),
          );
        } finally {
          // Only clear the spinner if this fetch is still the tracked one —
          // an earlier finisher must not clear a later file's loading state.
          if (loadingFileIdRef.current === id) {
            loadingFileIdRef.current = null;
            setLoadingFileId(null);
          }
        }
      }
    },
    [],
  );

  const handleRepoDelete = useCallback(
    (repoKey: string) => {
      // Compute everything outside the updater — updaters must stay pure,
      // and `removedIds` read synchronously after setFiles() was unreliable.
      const prev = filesRef.current;
      const removed = prev.filter(
        (f) => f.repoOrigin && `${f.repoOrigin.owner}/${f.repoOrigin.repo}` === repoKey,
      );
      if (removed.length === 0) return;
      const removedIds = removed.map((f) => f.id);
      const next = prev.filter((f) => {
        if (!f.repoOrigin) return true;
        return `${f.repoOrigin.owner}/${f.repoOrigin.repo}` !== repoKey;
      });
      setFiles(next);
      const currentActiveId = activeFileIdRef.current;
      if (currentActiveId && !next.some((f) => f.id === currentActiveId)) {
        setActiveFileId(next.length > 0 ? next[0]!.id : null);
      }
      // Unshare any removed file that is currently in the collab room —
      // otherwise it lingers as an editable ghost shared file backed by nothing.
      for (const f of removed) {
        if (sharedFileIdsRef.current.has(f.id)) collab.unshareFile(f.id);
      }
      import('@/lib/monacoModels')
        .then(({ disposeModelsForFiles }) => disposeModelsForFiles(removedIds))
        .catch(() => {});
    },
    [collab],
  );

  // Before localStorage has been read, render a bg-matching splash so the
  // "no snippets" / "Welcome" empty state never paints during refresh.
  // The theme bootstrap script in app/layout.tsx has already set the `dark`
  // or `light` class on <html>, so `dark:` and `light:` modifiers resolve
  // to the user's preference on the very first paint.
  if (!isInitialized) {
    return (
      <div
        className="min-h-screen bg-[#EEF1F5] dark:bg-[#232332]"
        aria-hidden
      />
    );
  }

  return (
    <div className="min-h-screen font-sans flex flex-col relative overflow-hidden">
      <EditorView
        files={files}
        activeFileId={activeFileId}
        loadingFileId={loadingFileId}
        onFileSelect={handleFileSelect}
        onFileCreate={handleFileCreate}
        onFileDelete={handleFileDelete}
        onFileUpload={handleFileUpload}
        onCodeChange={handleCodeChange}
        onLanguageChange={handleLanguageChange}
        onOpenGitHub={() => setShowGitHubModal(true)}
        onOpenCollab={() => setShowCollabModal(true)}
        onRepoDelete={handleRepoDelete}
        collab={collab}
        agent={agent}
      />
      <GitHubImportModal
        isOpen={showGitHubModal}
        onClose={() => setShowGitHubModal(false)}
        onImport={handleGitHubImport}
        onImportRepo={handleRepoImport}
      />
      <CollabRoomModal
        isOpen={showCollabModal}
        onClose={() => {
          setShowCollabModal(false);
          collab.clearJoinError();
        }}
        onCreateRoom={(name, id) => {
          collab.createRoom(name, id);
          setShowCollabModal(false);
        }}
        onJoinRoom={(name, id) => {
          collab.joinRoom(name, id);
        }}
        joinError={collab.joinError}
        onClearJoinError={collab.clearJoinError}
      />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
