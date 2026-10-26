'use client';

// Command palette (Ctrl/Cmd+K) — files, agent, workspace actions.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';

export interface PaletteAction {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void | Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onClose, actions }: Props) {
  const { isDark } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => `${a.group} ${a.label}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, filtered.length]);

  if (!open) return null;

  const execute = (action: PaletteAction | undefined) => {
    if (!action) return;
    onClose();
    void Promise.resolve(action.run()).catch(() => {});
  };

  // Group filtered results, preserving order.
  const groups: { group: string; items: { action: PaletteAction; index: number }[] }[] = [];
  filtered.forEach((action, index) => {
    const last = groups[groups.length - 1];
    if (last && last.group === action.group) last.items.push({ action, index });
    else groups.push({ group: action.group, items: [{ action, index }] });
  });

  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const textP = isDark ? 'text-white' : 'text-slate-900';
  const textM = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="fixed inset-0 z-90 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className={`relative w-full max-w-xl rounded-xl border ${border} shadow-2xl overflow-hidden ${
          isDark ? 'bg-[#1a1a2e]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              execute(filtered[selected]);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder="Type a command or file name…"
          className={`w-full px-4 py-3.5 bg-transparent text-sm ${textP} placeholder:text-slate-500 focus:outline-hidden border-b ${border}`}
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto custom-scrollbar p-1.5">
          {filtered.length === 0 && (
            <div className={`px-3 py-6 text-center text-xs ${textM}`}>No matching commands</div>
          )}
          {groups.map((g) => (
            <div key={`${g.group}-${g.items[0]!.index}`}>
              <div className={`px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${textM}`}>
                {g.group}
              </div>
              {g.items.map(({ action, index }) => (
                <button
                  key={action.id}
                  data-selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => execute(action)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                    index === selected
                      ? isDark
                        ? 'bg-[#CAA4F7]/15 text-[#CAA4F7]'
                        : 'bg-purple-50 text-purple-700'
                      : isDark
                        ? 'text-slate-300'
                        : 'text-slate-700'
                  }`}
                >
                  <span className="truncate font-medium">{action.label}</span>
                  {action.hint && <span className={`text-[10px] shrink-0 ml-3 ${textM}`}>{action.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className={`px-4 py-2 border-t ${border} text-[9px] ${textM} flex gap-3`}>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
