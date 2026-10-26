'use client';

// useAgent — the client side of the AI agent.
//
// The agent LOOP lives here, not on the server: workspace tools execute
// against browser state, so after each streamed model turn this hook runs
// the requested tools and sends a follow-up request with functionResponse
// parts until the model answers without tool calls (≤ MAX_ITERATIONS turns).
//
// The server route is a stateless, key-agnostic proxy: one model turn per
// request, SSE events back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoredFile } from '@/services/storageService';
import type { CollabProvider } from '@/services/collabService';
import {
  executeAgentTool,
  buildWorkspaceContext,
  previewPatch,
  MUTATING_TOOLS,
  KNOWN_TOOLS,
  MAX_AGENT_FILE_BYTES,
  type AgentWorkspaceContext,
  type ToolResult,
} from '@/lib/agentTools';

const THREAD_STORAGE = 'collabify-agent-thread';
const MAX_PERSISTED_ITEMS = 40;
const MAX_ATTACHMENTS = 2;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const MAX_ITERATIONS = 20;
const KEY_STORAGE = 'collabify-gemini-key';
const MODEL_STORAGE = 'collabify-agent-model';
const APPROVAL_STORAGE = 'collabify-agent-approval';

export const AGENT_MODELS = [
  { id: 'gemini-2.5-flash-lite', label: 'Flash Lite — fastest' },
  { id: 'gemini-2.5-flash', label: 'Flash — balanced' },
  { id: 'gemini-2.5-pro', label: 'Pro — most capable' },
] as const;

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentAttachment {
  mimeType: string;
  /** Base64 payload (no data: prefix). */
  data: string;
}

export interface AgentThreadItem {
  id: string;
  role: 'user' | 'model' | 'tool';
  /** Rendered text (user input or assistant answer). */
  text?: string;
  /** Images attached to a user message (not persisted). */
  attachments?: AgentAttachment[];
  /** Tool calls requested by the model (model items). */
  calls?: AgentToolCall[];
  /** Results returned for the previous model item's calls (tool items). */
  results?: { name: string; response: ToolResult }[];
  /** Web sources attached to a web_search result. */
  sources?: { uri: string; title: string }[];
  streaming?: boolean;
  error?: string;
}

export interface ApprovalPreview {
  before: string;
  after: string;
  language: string;
  title: string;
}

export type ApprovalMode = 'ask' | 'auto';

export interface PendingApproval {
  call: AgentToolCall;
  /** Renderable before/after for patch previews (edit_file/create_file). */
  preview?: ApprovalPreview;
  resolve: (allowed: boolean) => void;
}

export interface UseAgentOptions {
  /** Live workspace view — read fresh on every tool call. */
  getWorkspace: () => AgentWorkspaceContext;
}

// ─── Wire-format helpers ────────────────────────────────────────────────

type WirePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: ToolResult } };
type WireContent = { role: 'user' | 'model'; parts: WirePart[] };

function threadToContents(thread: AgentThreadItem[]): WireContent[] {
  const out: WireContent[] = [];
  for (const item of thread) {
    if (item.role === 'user') {
      if (item.text || item.attachments?.length) {
        const parts: WirePart[] = [];
        if (item.text) parts.push({ text: item.text });
        for (const a of item.attachments ?? []) {
          parts.push({ inlineData: { mimeType: a.mimeType, data: a.data } });
        }
        out.push({ role: 'user', parts });
      }
    } else if (item.role === 'model') {
      const parts: WirePart[] = [];
      if (item.text) parts.push({ text: item.text });
      for (const call of item.calls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else {
      // Tool results — sent back as the user side of the function-call protocol.
      const parts: WirePart[] = (item.results ?? []).map((r) => ({
        functionResponse: { name: r.name, response: r.response },
      }));
      if (parts.length > 0) out.push({ role: 'user', parts });
    }
  }
  return out;
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useAgent({ getWorkspace }: UseAgentOptions) {
  const [thread, setThread] = useState<AgentThreadItem[]>(() => {
    // Restore the last conversation (attachments are session-only).
    try {
      const raw = localStorage.getItem(THREAD_STORAGE);
      if (!raw) return [];
      const items = JSON.parse(raw) as AgentThreadItem[];
      return Array.isArray(items) ? items.slice(-MAX_PERSISTED_ITEMS).map((it) => ({ ...it, streaming: false })) : [];
    } catch {
      return [];
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  // Reactive mirror of localStorage so the key gate/composer update the
  // moment the key is saved or removed.
  const [hasKeyState, setHasKeyState] = useState(() => {
    try {
      return !!localStorage.getItem(KEY_STORAGE);
    } catch {
      return false;
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<AgentThreadItem[]>([]);
  threadRef.current = thread;

  const getApiKey = useCallback(() => {
    try {
      return localStorage.getItem(KEY_STORAGE);
    } catch {
      return null;
    }
  }, []);

  const setApiKey = useCallback((key: string | null) => {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* storage blocked — session-only */
    }
    setHasKeyState(!!key);
  }, []);

  const getModel = useCallback(() => {
    try {
      const stored = localStorage.getItem(MODEL_STORAGE);
      return stored && AGENT_MODELS.some((m) => m.id === stored) ? stored : AGENT_MODELS[0].id;
    } catch {
      return AGENT_MODELS[0].id;
    }
  }, []);

  const setModel = useCallback((id: string) => {
    try {
      localStorage.setItem(MODEL_STORAGE, id);
    } catch {
      /* ignore */
    }
  }, []);

  const getApprovalMode = useCallback((): ApprovalMode => {
    try {
      const stored = localStorage.getItem(APPROVAL_STORAGE);
      return stored === 'auto' ? 'auto' : 'ask';
    } catch {
      return 'ask';
    }
  }, []);

  const setApprovalMode = useCallback((mode: ApprovalMode) => {
    try {
      localStorage.setItem(APPROVAL_STORAGE, mode);
    } catch {
      /* ignore */
    }
  }, []);

  // Persist the conversation (minus images/streaming flags), debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const slim = thread
          .slice(-MAX_PERSISTED_ITEMS)
          .map(({ attachments, streaming, ...rest }) => ({
            ...rest,
            ...(attachments?.length ? { text: `${rest.text ?? ''}\n[image attached]` } : {}),
          }));
        localStorage.setItem(THREAD_STORAGE, JSON.stringify(slim));
      } catch {
        /* storage blocked */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [thread]);

  const pushItem = useCallback((item: AgentThreadItem) => {
    setThread((prev) => [...prev, item]);
  }, []);

  const patchLast = useCallback((patch: Partial<AgentThreadItem>) => {
    setThread((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1]!, ...patch };
      return next;
    });
  }, []);

  const resolveApproval = useCallback((allowed: boolean) => {
    setPendingApproval((pending) => {
      pending?.resolve(allowed);
      return null;
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearThread = useCallback(() => {
    abortRef.current?.abort();
    setThread([]);
    try {
      localStorage.removeItem(THREAD_STORAGE);
    } catch {
      /* ignore */
    }
  }, []);

  // ── One model turn over SSE ─────────────────────────────────────────

  type TurnResult =
    | { kind: 'text'; text: string }
    | { kind: 'tool-calls'; calls: AgentToolCall[]; text: string };

  async function runModelTurn(
    contents: WireContent[],
    mode: 'chat' | 'web_search' | 'code_exec',
    signal: AbortSignal,
    onDelta?: (accumulatedText: string) => void,
  ): Promise<{ text: string; calls: AgentToolCall[]; sources: { uri: string; title: string }[]; codeOutput?: string }> {
    const ws = getWorkspace();
    const key = getApiKey();
    if (!key) throw new Error('No Gemini API key set — add one in the agent settings.');

    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: getModel(),
        contents,
        mode,
        ...(mode === 'chat' ? { context: buildWorkspaceContext(ws) } : {}),
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => null);
      throw new Error(
        (detail as { error?: string } | null)?.error || `Agent request failed (${res.status}).`,
      );
    }

    // Parse the SSE stream.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let calls: AgentToolCall[] = [];
    let sources: { uri: string; title: string }[] = [];
    let codeOutput: string | undefined;
    let streamError: string | undefined;

    const handleEvent = (payload: Record<string, unknown>) => {
      switch (payload.type) {
        case 'text-delta':
          text += String(payload.text ?? '');
          if (mode === 'chat') onDelta?.(text);
          break;
        case 'tool-calls':
          calls = (payload.calls as AgentToolCall[]) || [];
          break;
        case 'sources':
          sources = (payload.sources as { uri: string; title: string }[]) || [];
          break;
        case 'code-output':
          codeOutput = String(payload.output ?? '');
          break;
        case 'error':
          streamError = String(payload.message ?? 'Agent error');
          break;
        default:
          break;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              handleEvent(JSON.parse(line.slice(6)));
            } catch {
              /* skip malformed event */
            }
          }
        }
      }
    }
    if (streamError) throw new Error(streamError);
    return { text, calls, sources, codeOutput };
  }

  // ── Tool execution (with approval gate for mutations) ───────────────

  const askApproval = useCallback(
    (call: AgentToolCall) =>
      new Promise<boolean>((resolve) => {
        // Build a renderable before/after preview so the user can judge the
        // change instead of trusting raw JSON args.
        let preview: ApprovalPreview | undefined;
        const ws = getWorkspace();
        const file = ws.files.find((f) => f.id === call.args.fileId);
        if (call.name === 'edit_file' && file && Array.isArray(call.args.edits)) {
          const p = previewPatch(file.content, call.args.edits as { find: string; replace: string }[]);
          if (p) preview = { before: p.before, after: p.after, language: file.language, title: file.name };
        } else if (call.name === 'create_file') {
          preview = { before: '', after: String(call.args.content ?? ''), language: '', title: String(call.args.name ?? 'new file') };
        }
        setPendingApproval({ call, preview, resolve });
      }),
    [getWorkspace],
  );

  async function executeCall(
    call: AgentToolCall,
    signal: AbortSignal,
  ): Promise<{ response: ToolResult; sources?: { uri: string; title: string }[] }> {
    const ws = getWorkspace();
    if (!KNOWN_TOOLS.has(call.name)) {
      return { response: { ok: false, error: `Unknown tool "${call.name}".` } };
    }
    if (MUTATING_TOOLS.has(call.name) && getApprovalMode() === 'ask') {
      const allowed = await askApproval(call);
      if (!allowed) return { response: { ok: false, error: 'The user denied this action.' } };
    }

    if (call.name === 'web_search') {
      const query = String(call.args.query ?? '').slice(0, 400);
      if (!query) return { response: { ok: false, error: 'web_search requires a query.' } };
      const turn = await runModelTurn(
        [{ role: 'user', parts: [{ text: query }] }],
        'web_search',
        signal,
      );
      return {
        response: { ok: true, query, answer: turn.text || '(no answer returned)' },
        sources: turn.sources,
      };
    }

    if (call.name === 'run_python') {
      const code = String(call.args.code ?? '');
      if (!code) return { response: { ok: false, error: 'run_python requires code.' } };
      const prompt =
        `Execute the following Python 3 code with the code execution tool and report the exact output.\n` +
        'Do not modify the code.\n\n```python\n' + code.slice(0, 20_000) + '\n```';
      const turn = await runModelTurn(
        [{ role: 'user', parts: [{ text: prompt }] }],
        'code_exec',
        signal,
      );
      return {
        response: {
          ok: true,
          output: turn.codeOutput || turn.text || '(no output produced)',
        },
      };
    }

    return { response: executeAgentTool(call.name, call.args, ws) };
  }

  // ── The agent loop ──────────────────────────────────────────────────

  const send = useCallback(
    async (rawText: string, attachments?: AgentAttachment[]) => {
      const text = rawText.trim();
      if ((!text && !attachments?.length) || isStreaming) return;
      if (!getApiKey()) {
        pushItem({
          id: `${Date.now()}-gate`,
          role: 'model',
          text: 'Add your Gemini API key in the agent settings (key icon above) to start.',
        });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const cleanAttachments = (attachments ?? []).slice(0, MAX_ATTACHMENTS).filter(
        (a) => a.mimeType.startsWith('image/') && a.data.length <= (MAX_ATTACHMENT_BYTES / 3) * 4,
      );

      // @-mentions: "@name" pulls the referenced file into the prompt so the
      // agent can work with precise context without burning a read call.
      let enriched = text;
      if (text.includes('@')) {
        const ws = getWorkspace();
        const mentioned: string[] = [];
        for (const match of text.matchAll(/@([\w.-]+)/g)) {
          if (mentioned.length >= 3) break;
          const name = match[1]!.toLowerCase();
          const file = ws.files.find(
            (f) => f.name.toLowerCase() === name || f.name.toLowerCase().startsWith(name),
          );
          if (file && file.contentLoaded !== false && file.content) {
            const lines = file.content.split('\n').slice(0, 150).join('\n');
            mentioned.push(`[File "${file.name}" (id=${file.id}) — first 150 lines:]\n${lines}`);
          }
        }
        if (mentioned.length) enriched = `${text}\n\n${mentioned.join('\n\n')}`;
      }

      const userId = `${Date.now()}-u`;
      pushItem({
        id: userId,
        role: 'user',
        text,
        ...(cleanAttachments.length ? { attachments: cleanAttachments } : {}),
      });
      // Local echo of the thread for the loop (state updates are async).
      const localThread: AgentThreadItem[] = [
        ...threadRef.current,
        { id: userId, role: 'user', text: enriched, ...(cleanAttachments.length ? { attachments: cleanAttachments } : {}) },
      ];

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const modelId = `${Date.now()}-m${iteration}`;
          setThread((prev) => [...prev, { id: modelId, role: 'model', text: '', streaming: true }]);

          const contents = threadToContents(localThread);
          const turn = await runModelTurn(contents, 'chat', controller.signal, (t) =>
            patchLast({ text: t }),
          );

          if (turn.calls.length > 0) {
            // Model wants tools: finalize the model item with its calls,
            // execute them, push results, loop.
            patchLast({ id: modelId, role: 'model', text: turn.text, calls: turn.calls, streaming: false });
            localThread.push({
              id: modelId,
              role: 'model',
              text: turn.text,
              calls: turn.calls,
            });

            const results: { name: string; response: ToolResult }[] = [];
            const sources: { uri: string; title: string }[] = [];
            for (const call of turn.calls) {
              const executed = await executeCall(call, controller.signal);
              results.push({ name: call.name, response: executed.response });
              if (executed.sources?.length) sources.push(...executed.sources);
            }
            const toolId = `${Date.now()}-t${iteration}`;
            setThread((prev) => [...prev, { id: toolId, role: 'tool', results, ...(sources.length ? { sources } : {}) }]);
            localThread.push({ id: toolId, role: 'tool', results });
            continue;
          }

          // Plain answer — the loop ends.
          patchLast({ id: modelId, role: 'model', text: turn.text, streaming: false });
          localThread.push({ id: modelId, role: 'model', text: turn.text });
          break;
        }
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? null // user pressed stop — the partial text stays
            : err instanceof Error
              ? err.message
              : 'Agent request failed.';
        if (message) {
          // Attach the error to the in-flight model item, or as its own item.
          setThread((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'model' && last.streaming) {
              next[next.length - 1] = { ...last, streaming: false, error: message };
            } else {
              next.push({ id: `${Date.now()}-err`, role: 'model', text: '', error: message });
            }
            return next;
          });
        } else {
          patchLast({ streaming: false });
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, getApiKey, getApprovalMode, getModel, getWorkspace, pushItem, patchLast, askApproval], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return useMemo(
    () => ({
      thread,
      isStreaming,
      pendingApproval,
      send,
      stop,
      clearThread,
      resolveApproval,
      hasKey: hasKeyState,
      getApiKey,
      setApiKey,
      getModel,
      setModel,
      getApprovalMode,
      setApprovalMode,
    }),
    [thread, isStreaming, pendingApproval, hasKeyState, send, stop, clearThread, resolveApproval, getApiKey, setApiKey, getModel, setModel, getApprovalMode, setApprovalMode],
  );
}

export type AgentController = ReturnType<typeof useAgent>;
