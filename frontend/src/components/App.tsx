'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { EditorView } from './EditorView';
import { ThemeProvider } from '@/hooks/useTheme';
import { useCollabRoom } from '@/hooks/useCollabRoom';
import { GitHubImportModal } from './GitHubImportModal';
import { CollabRoomModal } from './CollabRoomModal';
import {
  getStoredFiles,
  saveFiles,
  getActiveFileId,
  setActiveFileId as saveActiveFileId,
  computeContentHash,
  StoredFile,
} from '@/services/storageService';
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

  const collab = useCollabRoom();
  const autoSharedRef = useRef(false);
  // `files`, `activeFileId`, and `collab.shareFile` are needed inside an
  // effect that should not re-run on every keystroke. Latest-ref pattern.
  const filesRef = useRef(files);
  const activeFileIdRef = useRef(activeFileId);
  const shareFileRef = useRef(collab.shareFile);
  useEffect(() => {
    filesRef.current = files;
    activeFileIdRef.current = activeFileId;
    shareFileRef.current = collab.shareFile;
  });

  const { isHost: collabIsHost, status: collabStatus } = collab;
  const sharedCount = collab.sharedFiles.length;
  useEffect(() => {
    if (collabStatus === 'disconnected') {
      autoSharedRef.current = false;
      return;
    }
    if (
      collabIsHost &&
      collabStatus === 'connected' &&
      sharedCount === 0 &&
      !autoSharedRef.current
    ) {
      const activeId = activeFileIdRef.current;
      const file = activeId ? filesRef.current.find((f) => f.id === activeId) : null;
      if (file) {
        autoSharedRef.current = true;
        shareFileRef.current({
          id: file.id,
          name: file.name,
          language: file.language,
          content: file.content,
        });
      }
    }
  }, [collabIsHost, collabStatus, sharedCount]);

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

  useEffect(() => {
    if (!isInitialized) return;
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
      saveFiles(lastSavedFilesRef.current);
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
          const { detectLanguageAI } = await import('@/utils/detectLanguage');
          detectLanguageAI('', '').catch(() => {});
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
      id: Date.now().toString(),
      name: `Snippet-${files.length + 1}`,
      content: '',
      language: '',
      contentHash: computeContentHash(''),
      lastModified: Date.now(),
    };
    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(newFile.id);
  }, [files.length]);

  const handleFileUpload = useCallback(async (file: File) => {
    const text = await file.text();
    const fileId = Date.now().toString();
    const syncLanguage = detectLanguage(file.name, text);
    const newFile: StoredFile = {
      id: fileId,
      name: file.name,
      content: text,
      language: syncLanguage,
      contentHash: computeContentHash(text),
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
      setFiles((prev) => {
        const next = prev.filter((f) => f.id !== id);
        if (activeFileIdRef.current === id) {
          setActiveFileId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
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
              contentHash: computeContentHash(newCode),
              lastModified: Date.now(),
            }
          : f,
      ),
    );
  }, []);

  const handleLanguageChange = useCallback((id: string, language: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, language, lastModified: Date.now() } : f)),
    );
  }, []);

  const handleGitHubImport = useCallback((fileName: string, content: string, language: string) => {
    const fileId = Date.now().toString();
    const newFile: StoredFile = {
      id: fileId,
      name: fileName,
      content,
      language,
      contentHash: computeContentHash(content),
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
        id: `${Date.now()}-${i}`,
        name: fileName,
        content: '',
        language: detectLanguage(fileName, ''),
        contentHash: computeContentHash(''),
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
      const file = filesRef.current.find((f) => f.id === id);
      if (file && file.repoOrigin && !file.contentLoaded) {
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
                    contentHash: computeContentHash(content),
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
          setLoadingFileId(null);
        }
      }
    },
    [],
  );

  const handleRepoDelete = useCallback(
    (repoKey: string) => {
      let removedIds: string[] = [];
      setFiles((prev) => {
        removedIds = prev
          .filter((f) => f.repoOrigin && `${f.repoOrigin.owner}/${f.repoOrigin.repo}` === repoKey)
          .map((f) => f.id);
        const next = prev.filter((f) => {
          if (!f.repoOrigin) return true;
          return `${f.repoOrigin.owner}/${f.repoOrigin.repo}` !== repoKey;
        });
        const currentActiveId = activeFileIdRef.current;
        if (currentActiveId && !next.some((f) => f.id === currentActiveId)) {
          setActiveFileId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
      if (removedIds.length > 0) {
        import('@/lib/monacoModels')
          .then(({ disposeModelsForFiles }) => disposeModelsForFiles(removedIds))
          .catch(() => {});
      }
    },
    [],
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
