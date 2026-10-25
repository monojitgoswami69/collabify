'use client';

// Header account control: GitHub sign-in / avatar + account menu with sync
// status. Signing in also connects GitHub for imports (one OAuth popup
// serves both purposes).

import { useEffect, useRef, useState, memo } from 'react';
import Image from 'next/image';
import { LogIn, LogOut, RefreshCw, CloudCheck, CloudOff } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import type { Account } from '@/hooks/useAccount';

interface Props {
  account: Account;
  onSyncNow: () => void;
  syncing: boolean;
  lastSyncError?: string | null;
}

export const AccountMenu = memo(function AccountMenu({ account, onSyncNow, syncing, lastSyncError }: Props) {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';

  if (!account.user) {
    return (
      <button
        onClick={() => void account.signIn()}
        disabled={account.status === 'signing-in'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 border ${
          isDark
            ? 'bg-[#232340] hover:bg-[#2a2a50] text-slate-300 border-slate-700/50 hover:border-purple-500/50'
            : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300'
        } disabled:opacity-50`}
        title="Sign in with GitHub to sync your workspace across devices"
      >
        <LogIn size={13} />
        <span className="hidden sm:inline">{account.status === 'signing-in' ? 'Signing in…' : 'Sign in'}</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="rounded-full ring-2 ring-purple-500/30 hover:ring-purple-500/60 transition-all"
        title={`${account.user.login} — account`}
      >
        {account.user.avatarUrl ? (
          <Image
            src={account.user.avatarUrl}
            alt=""
            width={26}
            height={26}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <div className="w-[26px] h-[26px] rounded-full bg-[#CAA4F7] text-[#1E1E2A] text-[11px] font-bold flex items-center justify-center">
            {account.user.login.charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      {open && (
        <div
          ref={ref}
          className={`absolute top-full right-0 mt-2 z-50 w-64 rounded-xl border shadow-2xl overflow-hidden ${
            isDark ? 'bg-[#1a1a2e] border-slate-700/50' : 'bg-white border-slate-200'
          }`}
        >
          <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2.5">
              {account.user.avatarUrl && (
                <Image
                  src={account.user.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="rounded-full ring-2 ring-purple-500/30"
                  unoptimized
                />
              )}
              <div className="min-w-0">
                <div className={`text-xs font-bold truncate ${textPrimary(isDark)}`}>
                  {account.user.name || account.user.login}
                </div>
                <div className={`text-[10px] truncate ${textMuted}`}>@{account.user.login}</div>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 mt-2 text-[10px] ${textMuted}`}>
              {syncing ? (
                <>
                  <RefreshCw size={10} className="animate-spin text-[#CAA4F7]" /> Syncing…
                </>
              ) : lastSyncError ? (
                <>
                  <CloudOff size={10} className="text-amber-400" /> {lastSyncError}
                </>
              ) : (
                <>
                  <CloudCheck size={10} className="text-green-500" /> Workspace synced
                </>
              )}
            </div>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => {
                onSyncNow();
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isDark ? 'hover:bg-slate-800/50 text-slate-300' : 'hover:bg-slate-50 text-slate-600'
              }`}
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync now
            </button>
            <button
              onClick={() => {
                account.signOut();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function textPrimary(isDark: boolean) {
  return isDark ? 'text-white' : 'text-slate-900';
}
