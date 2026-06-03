'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useTheme } from '@/hooks/useTheme';
import {
  X,
  Github,
  Link2,
  Loader2,
  ArrowLeft,
  Download,
  FolderOpen,
  FileCode,
  Lock,
  Globe,
  ChevronRight,
  LogOut,
  AlertCircle,
  Check,
  Search,
} from 'lucide-react';
import {
  getStoredToken,
  storeToken,
  clearToken,
  startOAuthPopup,
  fetchGitHubUser,
  getStoredUser,
  storeUser,
  listRepos,
  getRepoContents,
  fetchFileContent,
  fetchFromPublicUrl,
  parseGitHubUrl,
  fetchRepoTree,
  GitHubUser,
  GitHubRepo,
  GitHubContent,
  RepoTreeItem,
} from '@/services/githubService';
import { useMountTransition } from '@/hooks/useMountTransition';
import { detectLanguageAI } from '@/utils/detectLanguage';

type Tab = 'url' | 'connect';
type BrowseView = 'auth' | 'repos' | 'files';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (fileName: string, content: string, language: string) => void;
  onImportRepo?: (repo: GitHubRepo, tree: RepoTreeItem[]) => void;
}

export function GitHubImportModal({ isOpen, onClose, onImport, onImportRepo }: Props) {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('url');

  const [url, setUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [urlSuccess, setUrlSuccess] = useState('');

  const [browseView, setBrowseView] = useState<BrowseView>('auth');
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  const [contents, setContents] = useState<GitHubContent[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [importingFile, setImportingFile] = useState<string | null>(null);
  const [importingRepo, setImportingRepo] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const storedToken = getStoredToken();
      const storedUser = getStoredUser();
      if (storedToken && storedUser) {
        setUser(storedUser);
        setBrowseView('repos');
      } else {
        setBrowseView('auth');
      }
    }
  }, [isOpen]);

  const loadRepos = useCallback(async () => {
    const t = getStoredToken();
    if (!t) return;
    setReposLoading(true);
    try {
      const data = await listRepos(t, 1, 100);
      setRepos(data);
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (browseView === 'repos' && user) loadRepos();
  }, [browseView, user, loadRepos]);

  const handleConnect = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const accessToken = await startOAuthPopup();
      const ghUser = await fetchGitHubUser(accessToken);
      storeToken(accessToken);
      storeUser(ghUser);
      setUser(ghUser);
      setBrowseView('repos');
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnect = () => {
    clearToken();
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setContents([]);
    setCurrentPath('');
    setPathHistory([]);
    setBrowseView('auth');
  };

  const loadContents = async (owner: string, repo: string, path: string) => {
    const t = getStoredToken();
    if (!t) return;
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await getRepoContents(t, owner, repo, path);
      data.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setContents(data);
    } catch (e) {
      setFilesError((e as Error).message);
    } finally {
      setFilesLoading(false);
    }
  };

  const handleSelectRepo = async (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setCurrentPath('');
    setPathHistory([]);
    setBrowseView('files');
    await loadContents(repo.owner.login, repo.name, '');
  };

  const handleNavigateDir = async (dirPath: string) => {
    if (!selectedRepo) return;
    setPathHistory((prev) => [...prev, currentPath]);
    setCurrentPath(dirPath);
    await loadContents(selectedRepo.owner.login, selectedRepo.name, dirPath);
  };

  const handleGoBack = async () => {
    if (!selectedRepo) return;
    if (pathHistory.length === 0) {
      setBrowseView('repos');
      setSelectedRepo(null);
      return;
    }
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory((h) => h.slice(0, -1));
    setCurrentPath(prev);
    await loadContents(selectedRepo.owner.login, selectedRepo.name, prev);
  };

  const handleImportFile = async (item: GitHubContent) => {
    if (!item.download_url) return;
    setImportingFile(item.path);
    try {
      const t = getStoredToken();
      const content = await fetchFileContent(item.download_url, t);
      const lang = await detectLanguageAI(item.name, content);
      onImport(item.name, content, lang);
      onClose();
    } catch (e) {
      setFilesError((e as Error).message);
    } finally {
      setImportingFile(null);
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    if (!parseGitHubUrl(url.trim())) {
      setUrlError(
        'Invalid GitHub URL. Use a github.com/…/blob/… or raw.githubusercontent.com/… link.',
      );
      return;
    }
    setUrlLoading(true);
    setUrlError('');
    setUrlSuccess('');
    try {
      const { fileName, content } = await fetchFromPublicUrl(url.trim());
      const lang = await detectLanguageAI(fileName, content);
      setUrlSuccess(`Imported "${fileName}" successfully!`);
      onImport(fileName, content, lang);
      setTimeout(() => {
        onClose();
        setUrl('');
        setUrlSuccess('');
      }, 800);
    } catch (e) {
      setUrlError((e as Error).message);
    } finally {
      setUrlLoading(false);
    }
  };

  const filteredRepos = repoSearch
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
          r.full_name.toLowerCase().includes(repoSearch.toLowerCase()),
      )
    : repos;

  const resetAndClose = useCallback(() => {
    setUrl('');
    setUrlError('');
    setUrlSuccess('');
    setAuthError('');
    setFilesError('');
    onClose();
  }, [onClose]);

  const { hasRendered, isActive } = useMountTransition(isOpen, 300);
  if (!hasRendered) return null;

  const bg = isDark ? 'bg-[#1a1a2e]' : 'bg-white';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const text = isDark ? 'text-slate-200' : 'text-slate-800';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDark
    ? 'bg-[#232340] border-slate-600/50 text-white placeholder:text-slate-500'
    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400';
  const hoverBg = isDark ? 'hover:bg-[#2a2a45]' : 'hover:bg-slate-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={resetAndClose}>
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative ${bg} rounded-2xl shadow-2xl border ${border} w-[640px] max-h-[85vh] flex flex-col overflow-hidden transition-all duration-300 ease-out transform ${isActive ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${border}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Github size={18} className="text-white" />
            </div>
            <div>
              <h2 className={`text-lg font-semibold ${text}`}>Import from GitHub</h2>
              <p className={`text-xs ${textMuted}`}>Paste a link or browse your repos</p>
            </div>
          </div>
          <button
            onClick={resetAndClose}
            className={`p-2 rounded-lg ${hoverBg} transition-colors ${textMuted}`}
          >
            <X size={18} />
          </button>
        </div>

        <div className={`flex border-b ${border} px-6`}>
          {(
            [
              ['url', Link2, 'Paste URL'] as const,
              ['connect', Github, 'Connect GitHub'] as const,
            ]
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-purple-500 text-purple-400' : `border-transparent ${textMuted} hover:text-purple-400`}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {(tab === 'url' || (tab === 'connect' && browseView === 'auth')) && (
            <div className="grid">
              <div
                className={`col-start-1 row-start-1 p-6 space-y-4 transition-opacity duration-200 ${tab === 'url' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}
              >
                <p className={`text-sm ${textMuted}`}>
                  Paste a public GitHub file link to import it directly into the editor.
                </p>
                <div className="space-y-3">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setUrlError('');
                      setUrlSuccess('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                    placeholder="https://github.com/owner/repo/blob/main/file.ts"
                    className={`w-full px-4 py-3 rounded-xl border text-sm font-mono ${inputBg} focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all`}
                    autoFocus={tab === 'url'}
                  />
                  {urlError && (
                    <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span>{urlError}</span>
                    </div>
                  )}
                  {urlSuccess && (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 rounded-lg px-3 py-2">
                      <Check size={14} />
                      <span>{urlSuccess}</span>
                    </div>
                  )}
                  <button
                    onClick={handleUrlImport}
                    disabled={urlLoading || !url.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
                  >
                    {urlLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Github size={16} />
                    )}
                    {urlLoading ? 'Importing...' : 'Import File'}
                  </button>
                </div>
                <div className={`text-xs ${textMuted} space-y-1 pt-2`}>
                  <p className="font-medium">Supported URL formats:</p>
                  <code
                    className={`block px-3 py-1.5 rounded-lg ${isDark ? 'bg-[#232340]' : 'bg-slate-100'} text-[11px]`}
                  >
                    github.com/owner/repo/blob/branch/path/file.ext
                  </code>
                  <code
                    className={`block px-3 py-1.5 rounded-lg ${isDark ? 'bg-[#232340]' : 'bg-slate-100'} text-[11px]`}
                  >
                    raw.githubusercontent.com/owner/repo/branch/path/file.ext
                  </code>
                </div>
              </div>

              <div
                className={`col-start-1 row-start-1 p-6 space-y-5 transition-opacity duration-200 ${tab === 'connect' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}
              >
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-600/20 flex items-center justify-center">
                    <Github size={32} className={isDark ? 'text-white' : 'text-slate-800'} />
                  </div>
                  <h3 className={`text-base font-semibold mb-1 ${text}`}>
                    Connect your GitHub account
                  </h3>
                  <p className={`text-sm ${textMuted}`}>
                    Sign in with GitHub to browse and import files from all your repositories —
                    including private ones.
                  </p>
                </div>
                {authError && (
                  <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}
                <button
                  onClick={handleConnect}
                  disabled={authLoading}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 bg-gradient-to-r from-[#24292f] to-[#1b1f23] hover:from-[#32383f] hover:to-[#24292f] text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/20 border border-white/10"
                >
                  {authLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> Authenticating…
                    </>
                  ) : (
                    <>
                      <Github size={18} /> Sign in with GitHub
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {tab === 'connect' && browseView === 'repos' && (
            <div className="flex flex-col h-full">
              {user && (
                <div
                  className={`flex items-center justify-between px-6 py-3 border-b ${border}`}
                >
                  <div className="flex items-center gap-3">
                    <Image
                      src={user.avatar_url}
                      alt=""
                      width={28}
                      height={28}
                      className="rounded-full ring-2 ring-purple-500/30"
                      unoptimized
                    />
                    <span className={`text-sm font-medium ${text}`}>
                      {user.name || user.login}
                    </span>
                    <span className={`text-xs ${textMuted}`}>@{user.login}</span>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    <LogOut size={13} /> Disconnect
                  </button>
                </div>
              )}
              <div className="px-6 py-3">
                <div className="relative">
                  <Search
                    size={15}
                    className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`}
                  />
                  <input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all`}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-1">
                {reposLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-purple-400" />
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className={`text-center py-12 ${textMuted} text-sm`}>
                    No repositories found.
                  </div>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${hoverBg} group`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        {repo.private ? (
                          <Lock size={14} className="text-amber-400 shrink-0" />
                        ) : (
                          <Globe size={14} className={`${textMuted} shrink-0`} />
                        )}
                        <div className="text-left truncate">
                          <div className={`text-sm font-medium ${text} truncate`}>
                            {repo.name}
                          </div>
                          {repo.description && (
                            <div className={`text-xs ${textMuted} truncate`}>
                              {repo.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {repo.language && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'}`}
                          >
                            {repo.language}
                          </span>
                        )}
                        <ChevronRight
                          size={14}
                          className={`${textMuted} group-hover:text-purple-400 transition-colors`}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'connect' && browseView === 'files' && selectedRepo && (
            <div className="flex flex-col h-full">
              <div
                className={`flex items-center justify-between px-6 py-3 border-b ${border}`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGoBack}
                    className={`p-1.5 rounded-lg ${hoverBg} ${textMuted} hover:text-purple-400 transition-colors`}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="flex items-center gap-1 text-sm truncate">
                    <span className={`font-medium ${text}`}>{selectedRepo.name}</span>
                    {currentPath && (
                      <>
                        <span className={textMuted}>/</span>
                        <span className={`${textMuted} truncate`}>{currentPath}</span>
                      </>
                    )}
                  </div>
                </div>
                {onImportRepo && !currentPath && (
                  <button
                    onClick={async () => {
                      const t = getStoredToken();
                      if (!t || !selectedRepo) return;
                      setImportingRepo(true);
                      try {
                        const data = await fetchRepoTree(
                          t,
                          selectedRepo.owner.login,
                          selectedRepo.name,
                          selectedRepo.default_branch,
                        );
                        onImportRepo(selectedRepo, data.tree);
                        onClose();
                      } catch (e) {
                        setFilesError((e as Error).message);
                      } finally {
                        setImportingRepo(false);
                      }
                    }}
                    disabled={importingRepo}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50 shadow-md shrink-0"
                  >
                    {importingRepo ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    {importingRepo ? 'Importing…' : 'Import Repo'}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2 space-y-0.5">
                {filesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-purple-400" />
                  </div>
                ) : filesError ? (
                  <div className="flex items-center gap-2 text-red-400 text-xs p-4">
                    <AlertCircle size={14} />
                    {filesError}
                  </div>
                ) : (
                  contents.map((item) => (
                    <button
                      key={item.sha}
                      onClick={() =>
                        item.type === 'dir'
                          ? handleNavigateDir(item.path)
                          : handleImportFile(item)
                      }
                      disabled={importingFile === item.path}
                      className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${hoverBg} group disabled:opacity-60`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        {item.type === 'dir' ? (
                          <FolderOpen size={15} className="text-blue-400 shrink-0" />
                        ) : (
                          <FileCode size={15} className={`${textMuted} shrink-0`} />
                        )}
                        <span className={`text-sm ${text} truncate`}>{item.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {importingFile === item.path ? (
                          <Loader2 size={14} className="animate-spin text-purple-400" />
                        ) : item.type === 'dir' ? (
                          <ChevronRight
                            size={14}
                            className={`${textMuted} group-hover:text-purple-400 transition-colors`}
                          />
                        ) : (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-purple-500/20 text-purple-300`}
                          >
                            Import
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
