'use client';

// AgentSidebar — the in-editor AI agent panel.
//
// Sections: settings (API key / model / approval mode), the conversation
// thread (user + assistant bubbles, tool-call cards, approval prompts,
// web sources), and the composer. The key lives only in this browser's
// localStorage and is sent per-request to /api/ai/chat — nowhere else.

import { useEffect, useRef, useState, memo } from 'react';
import dynamic from 'next/dynamic';
import {
  Sparkles,
  X,
  Send,
  Square,
  Settings,
  KeyRound,
  Trash2,
  Wrench,
  Globe,
  Terminal,
  FilePlus2,
  FilePen,
  FileX2,
  ListTree,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Check,
  ShieldCheck,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentController } from '@/hooks/useAgent';
import type { AgentAttachment } from '@/hooks/useAgent';

// Lazy — the diff editor ships with the agent panel, not the main bundle.
const DiffEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] flex items-center justify-center">
      <Loader2 size={16} className="animate-spin text-[#CAA4F7]" />
    </div>
  ),
});
import { AGENT_MODELS } from '@/hooks/useAgent';

interface Props {
  agent: AgentController;
  onClose: () => void;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  list_files: ListTree,
  read_file: BookOpen,
  create_file: FilePlus2,
  edit_file: FilePen,
  delete_file: FileX2,
  web_search: Globe,
  run_python: Terminal,
};

function toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
      return `Read ${String(args.fileId ?? '').slice(0, 8)}`;
    case 'create_file':
      return `Create ${String(args.name ?? '')}`;
    case 'edit_file':
      return `Patch ${String(args.fileId ?? '').slice(0, 8)}`;
    case 'delete_file':
      return `Delete ${String(args.fileId ?? '').slice(0, 8)}`;
    case 'web_search':
      return `Search: ${String(args.query ?? '').slice(0, 40)}`;
    case 'run_python':
      return 'Run Python';
    default:
      return name;
  }
}

function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? '';
  const clipped = text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text;
  return (
    <pre className="mt-1.5 max-h-44 overflow-auto rounded-md bg-black/20 dark:bg-black/30 p-2 text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-all custom-scrollbar">
      {clipped}
    </pre>
  );
}

function ToolCard({
  name,
  args,
  response,
}: {
  name: string;
  args: Record<string, unknown>;
  response?: { [k: string]: unknown };
}) {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const failed = response ? response.ok === false : false;
  const isMutating = ['create_file', 'edit_file', 'delete_file'].includes(name);

  return (
    <div
      className={`rounded-lg border text-[11px] ${
        failed
          ? 'border-red-500/40 bg-red-500/5'
          : isDark
            ? 'border-slate-700/50 bg-[#232340]'
            : 'border-slate-200 bg-white'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown size={11} className={isDark ? 'text-slate-500' : 'text-slate-400'} />
        ) : (
          <ChevronRight size={11} className={isDark ? 'text-slate-500' : 'text-slate-400'} />
        )}
        <Icon size={12} className={failed ? 'text-red-400' : 'text-[#CAA4F7]'} />
        <span className={`font-semibold ${failed ? 'text-red-400' : isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          {toolLabel(name, args)}
        </span>
        {isMutating && !failed && (
          <Check size={11} className="ml-auto text-green-500" />
        )}
      </button>
      {open && (
        <div className={`px-2.5 pb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5">Arguments</div>
          <JsonBlock value={args} />
          {response && (
            <>
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5 mt-2">Result</div>
              <JsonBlock value={response} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const AgentSidebar = memo(function AgentSidebar({ agent, onClose }: Props) {
  const { isDark } = useTheme();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [model, setModelState] = useState(agent.getModel());
  const [approval, setApprovalState] = useState(agent.getApprovalMode());
  const [keySaved, setKeySaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const hasKey = agent.hasKey;

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.thread, agent.pendingApproval]);

  const handleSaveKey = () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    agent.setApiKey(trimmed);
    setKeyDraft('');
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  };

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || agent.isStreaming) return;
    agent.send(input, attachments);
    setInput('');
    setAttachments([]);
  };

  // Paste images directly into the composer (multimodal prompts).
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.items]
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
      .slice(0, 2 - attachments.length);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      if (file.size > 3 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        setAttachments((prev) =>
          prev.length >= 2 ? prev : [...prev, { mimeType: file.type || 'image/png', data: base64 }],
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const bg = isDark ? 'bg-[#1E1E2A]' : 'bg-[#F0F2F6]';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-300/50';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDark ? 'bg-[#232340] border-slate-600/50' : 'bg-white border-slate-300';
  const userBubble = 'bg-[#CAA4F7] text-[#1E1E2A]';
  const modelBubble = isDark ? 'bg-[#232340] text-slate-200' : 'bg-white text-slate-800 border border-slate-200/80';

  return (
    <div className={`flex flex-col h-full border-l ${border} ${bg} shadow-2xl md:shadow-none`} style={{ width: 380, minWidth: 380 }}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-3 border-b ${border} shrink-0`}>
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-[#CAA4F7]" />
          <h2 className={`text-xs font-bold uppercase tracking-wider ${textMuted}`}>AI Agent</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-md transition-colors ${showSettings ? 'text-[#CAA4F7] bg-[#CAA4F7]/10' : textMuted}`}
            title="Agent settings"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={agent.clearThread}
            className={`p-1.5 rounded-md transition-colors ${textMuted} hover:text-red-500`}
            title="New chat"
          >
            <Trash2 size={14} />
          </button>
          <button onClick={onClose} className={`p-1.5 rounded-md ${textMuted} hover:text-red-500`} title="Close">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className={`px-3 py-3 border-b ${border} space-y-3 shrink-0`}>
          <div>
            <label className={`block text-[9px] font-bold uppercase tracking-wider mb-1 ${textMuted}`}>
              Gemini API key {hasKey && <span className="text-green-500 normal-case font-medium">· saved</span>}
            </label>
            <div className="flex gap-1.5">
              <div className={`relative flex-1`}>
                <KeyRound size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 ${textMuted}`} />
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  placeholder={hasKey ? '•••••••• (replace)' : 'Paste your API key'}
                  className={`w-full pl-7 pr-2 py-1.5 rounded-md border text-[11px] ${inputBg} ${textPrimary} focus:outline-hidden focus:ring-1 focus:ring-[#CAA4F7]/50`}
                />
              </div>
              <button
                onClick={handleSaveKey}
                disabled={!keyDraft.trim()}
                className="px-2 rounded-md bg-[#CAA4F7] text-[#1E1E2A] text-[10px] font-bold disabled:opacity-40"
              >
                {keySaved ? <Check size={12} /> : 'Save'}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#CAA4F7] hover:underline inline-flex items-center gap-0.5"
              >
                Get a free key <ExternalLink size={9} />
              </a>
              {hasKey && (
                <button
                  onClick={() => {
                    agent.setApiKey(null);
                    setKeyDraft('');
                  }}
                  className="text-[10px] text-red-400 hover:underline"
                >
                  Remove key
                </button>
              )}
            </div>
          </div>

          <div>
            <label className={`block text-[9px] font-bold uppercase tracking-wider mb-1 ${textMuted}`}>Model</label>
            <select
              value={model}
              onChange={(e) => {
                agent.setModel(e.target.value);
                setModelState(e.target.value);
              }}
              className={`w-full px-2 py-1.5 rounded-md border text-[11px] ${inputBg} ${textPrimary} focus:outline-hidden`}
            >
              {AGENT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider mb-1 ${textMuted}`}>
              <ShieldCheck size={10} /> File edits
            </label>
            <div className="flex gap-1">
              {(['ask', 'auto'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    agent.setApprovalMode(mode);
                    setApprovalState(mode);
                  }}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors ${
                    approval === mode
                      ? 'bg-[#CAA4F7] text-[#1E1E2A]'
                      : isDark
                        ? 'bg-[#232340] text-slate-400 border border-slate-600/50'
                        : 'bg-white text-slate-500 border border-slate-300'
                  }`}
                >
                  {mode === 'ask' ? 'Ask first' : 'Auto-apply'}
                </button>
              ))}
            </div>
            <p className={`text-[9px] mt-1 ${textMuted}`}>
              {approval === 'ask'
                ? 'The agent asks before creating, patching, or deleting files.'
                : 'The agent applies file changes immediately — every change is still logged in the thread.'}
            </p>
          </div>
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {agent.thread.length === 0 && (
          <div className={`flex flex-col items-center justify-center h-full py-10 ${textMuted} text-center px-4`}>
            <Sparkles size={26} className="mb-3 opacity-40" />
            <p className="text-xs font-semibold">Your workspace-aware coding agent</p>
            <p className="text-[10px] mt-1.5 leading-relaxed opacity-80">
              Ask about your code, request changes, search the web, or run Python to check logic.
              {'\n'}It can read, create, patch, and delete files — with your approval.
            </p>
            <div className="mt-4 space-y-1.5 text-left">
              {['Explain what the active file does', 'Add input validation to the largest file', 'Search for the React 19 use() hook docs'].map((s) => (
                <button
                  key={s}
                  onClick={() => agent.send(s)}
                  className={`block w-full text-left px-2.5 py-1.5 rounded-md border text-[10px] transition-colors ${
                    isDark ? 'border-slate-700/50 hover:bg-[#232340]' : 'border-slate-200 hover:bg-white'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {agent.thread.map((item) => {
          if (item.role === 'user') {
            return (
              <div key={item.id} className="flex justify-end">
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-[12px] leading-relaxed ${userBubble} rounded-tr-sm whitespace-pre-wrap break-words`}>
                  {item.text}
                  {!!item.attachments?.length && (
                    <div className="flex gap-1.5 mt-1.5 justify-end">
                      {item.attachments.map((a, i) => (
                        <img
                          key={i}
                          src={`data:${a.mimeType};base64,${a.data}`}
                          alt="attachment"
                          className="w-16 h-16 object-cover rounded-md"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (item.role === 'tool') {
            return (
              <div key={item.id} className="space-y-1.5">
                {(item.results ?? []).map((r, i) => (
                  <ToolCard
                    key={`${item.id}-${i}`}
                    name={r.name}
                    args={matchedArgs(agent, item.id, i)}
                    response={r.response}
                  />
                ))}
                {!!item.sources?.length && (
                  <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${isDark ? 'border-slate-700/50 bg-[#232340]' : 'border-slate-200 bg-white'}`}>
                    <div className={`flex items-center gap-1 font-bold mb-1 ${textMuted}`}>
                      <Globe size={10} /> Sources
                    </div>
                    <ul className="space-y-0.5">
                      {item.sources.slice(0, 6).map((s) => (
                        <li key={s.uri} className="truncate">
                          <a href={s.uri} target="_blank" rel="noreferrer" className="text-[#CAA4F7] hover:underline">
                            {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          }

          // model item
          return (
            <div key={item.id} className="flex justify-start">
              <div className={`max-w-[90%] px-3 py-2 rounded-lg text-[12px] leading-relaxed ${modelBubble} rounded-tl-sm`}>
                {item.calls && item.calls.length > 0 && !item.text && (
                  <div className="flex items-center gap-1.5 text-[#CAA4F7] text-[11px] font-semibold">
                    <Loader2 size={11} className="animate-spin" /> Working…
                  </div>
                )}
                {item.text && <div className="whitespace-pre-wrap break-words">{item.text}</div>}
                {item.streaming && !item.text && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Loader2 size={11} className={`animate-spin ${textMuted}`} />
                    <span className={textMuted}>Thinking…</span>
                  </div>
                )}
                {item.error && <div className="text-red-400 text-[11px]">{item.error}</div>}
              </div>
            </div>
          );
        })}

        {/* Pending approval */}
        {agent.pendingApproval && (
          <div className={`rounded-lg border-2 border-[#CAA4F7]/60 p-3 ${isDark ? 'bg-[#232340]' : 'bg-white'}`}>
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <ShieldCheck size={13} className="text-[#CAA4F7]" />
              <span className={textPrimary}>Allow {agent.pendingApproval.call.name}?</span>
            </div>
            <p className={`text-[10px] mt-1 ${textMuted}`}>
              {agent.pendingApproval.call.name === 'delete_file'
                ? 'This permanently deletes the file from your workspace.'
                : agent.pendingApproval.call.name === 'create_file'
                  ? `Creates "${String(agent.pendingApproval.call.args.name ?? '')}" in your workspace.`
                  : 'This applies a find/replace patch to the file.'}
            </p>
            {agent.pendingApproval.preview ? (
              <div className="mt-2 rounded-md overflow-hidden border border-[#CAA4F7]/30">
                <div className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${textMuted}`}>
                  {agent.pendingApproval.preview.title} — before → after
                </div>
                <DiffEditor
                  height="220px"
                  original={agent.pendingApproval.preview.before}
                  modified={agent.pendingApproval.preview.after}
                  language={agent.pendingApproval.preview.language || 'plaintext'}
                  theme={isDark ? 'vs-dark' : 'vs'}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    renderSideBySide: false,
                    lineNumbers: 'off',
                    fontSize: 11,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                  }}
                />
              </div>
            ) : (
              <JsonBlock value={agent.pendingApproval.call.args} />
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => agent.resolveApproval(true)}
                className="flex-1 py-1.5 rounded-md bg-green-500/20 text-green-500 text-[11px] font-bold hover:bg-green-500/30"
              >
                Allow
              </button>
              <button
                onClick={() => agent.resolveApproval(false)}
                className="flex-1 py-1.5 rounded-md bg-red-500/15 text-red-400 text-[11px] font-bold hover:bg-red-500/25"
              >
                Deny
              </button>
            </div>
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <div className={`p-3 border-t ${border} shrink-0`}>
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                <img
                  src={`data:${a.mimeType};base64,${a.data}`}
                  alt="attachment"
                  className="w-14 h-14 object-cover rounded-md border border-[#CAA4F7]/40"
                />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={hasKey ? 'Ask about your code, request changes…' : 'Add your Gemini API key first (settings icon)'}
            disabled={!hasKey}
            rows={2}
            className={`w-full px-3 py-2 pr-10 rounded-lg text-[12px] border ${inputBg} ${textPrimary} placeholder:text-slate-400/60 focus:outline-hidden focus:ring-1 focus:ring-[#CAA4F7]/50 resize-none custom-scrollbar`}
          />
          {agent.isStreaming ? (
            <button
              onClick={agent.stop}
              className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25"
              title="Stop"
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && attachments.length === 0) || !hasKey}
              className={`absolute right-1.5 bottom-1.5 p-1.5 rounded-md transition-colors ${
                (input.trim() || attachments.length > 0) && hasKey ? 'text-[#CAA4F7] hover:bg-[#CAA4F7]/10' : 'opacity-30 cursor-not-allowed text-[#CAA4F7]'
              }`}
              title="Send"
            >
              <Send size={13} />
            </button>
          )}
        </div>
        <p className={`text-[9px] mt-1.5 text-center ${textMuted}`}>
          {model.replace('gemini-2.5-', 'Gemini ')} · your API key stays in this browser
        </p>
      </div>
    </div>
  );
});

/** Find the args for result slot i by walking back to the preceding model item's calls. */
function matchedArgs(agent: AgentController, toolItemId: string, index: number): Record<string, unknown> {
  const idx = agent.thread.findIndex((t) => t.id === toolItemId);
  if (idx <= 0) return {};
  for (let i = idx - 1; i >= 0; i--) {
    const item = agent.thread[i]!;
    if (item.role === 'model' && item.calls) {
      return item.calls[index]?.args ?? {};
    }
  }
  return {};
}
