'use client';

// Collabify account — GitHub OAuth identity + session management.
//
// Reuses the existing GitHub OAuth popup flow: the GitHub access token is
// exchanged at /api/auth/session for an opaque Collabify session token
// (30 days, stored in localStorage). The GitHub token itself keeps serving
// the GitHub proxy routes; workspace sync uses only the session token.

import { useCallback, useEffect, useState } from 'react';
import { getStoredToken, startOAuthPopup } from '@/services/githubService';

const SESSION_KEY = 'collabify-session-token';
const USER_KEY = 'collabify-account-user';

export interface AccountUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export type AccountStatus = 'signed-out' | 'signing-in' | 'ready';

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

export function useAccount() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [status, setStatus] = useState<AccountStatus>('signed-out');
  const [error, setError] = useState<string | null>(null);

  // Restore a persisted session on mount.
  useEffect(() => {
    try {
      const token = localStorage.getItem(SESSION_KEY);
      const saved = readJSON<AccountUser>(USER_KEY);
      if (token && saved) {
        setUser(saved);
        setStatus('ready');
      }
    } catch {
      /* storage blocked */
    }
  }, []);

  const exchange = useCallback(async (githubToken: string): Promise<AccountUser | null> => {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubToken }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error || `Sign-in failed (${res.status})`);
    }
    const data = (await res.json()) as { sessionToken: string; user: AccountUser };
    try {
      localStorage.setItem(SESSION_KEY, data.sessionToken);
      writeJSON(USER_KEY, data.user);
    } catch {
      /* storage blocked — session-only sign-in */
    }
    setUser(data.user);
    setStatus('ready');
    return data.user;
  }, []);

  const signIn = useCallback(async (): Promise<AccountUser | null> => {
    setError(null);
    setStatus('signing-in');
    try {
      // Reuse the GitHub token if the user already connected GitHub;
      // otherwise run the OAuth popup once — it serves both purposes.
      const existing = getStoredToken();
      const accountUser = existing
        ? await exchange(existing)
        : await exchange(await startOAuthPopup());
      return accountUser;
    } catch (e) {
      setError((e as Error).message);
      setStatus('signed-out');
      return null;
    }
  }, [exchange]);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setStatus('signed-out');
    setError(null);
  }, []);

  const getSessionToken = useCallback((): string | null => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }, []);

  return { user, status, error, signIn, signOut, getSessionToken };
}

export type Account = ReturnType<typeof useAccount>;
