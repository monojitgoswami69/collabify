'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CollabProvider,
  CollabMember,
  PendingRequest,
  CollabStatus,
  SharedFileInfo,
  CollabEvents,
  getRandomColor,
  ChatMessage,
} from '@/services/collabService';

export type CollabToast = {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  exiting?: boolean;
};

export interface CollabState {
  status: CollabStatus;
  roomId: string | null;
  isHost: boolean;
  isLocked: boolean;
  /** Peer whose file changes we are following (null = not following). */
  followingPeerId: string | null;
  displayName: string;
  color: string;
  members: CollabMember[];
  pending: PendingRequest[];
  sharedFiles: SharedFileInfo[];
  provider: CollabProvider | null;
  toasts: CollabToast[];
  chatMessages: ChatMessage[];
  peerId: string;
}

export function useCollabRoom() {
  const [state, setState] = useState<CollabState>({
    status: 'disconnected',
    roomId: null,
    isHost: false,
    isLocked: false,
    followingPeerId: null,
    displayName: '',
    color: getRandomColor(),
    members: [],
    pending: [],
    sharedFiles: [],
    provider: null,
    toasts: [],
    chatMessages: [],
    peerId: '',
  });

  const [joinError, setJoinError] = useState<string | null>(null);
  const providerRef = useRef<CollabProvider | null>(null);
  // Outstanding toast dismissal/reset timers — cleared on unmount so no timer
  // fires setState on a dead hook.
  const toastTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const trackTimer = useCallback(<T extends ReturnType<typeof setTimeout>>(t: T): T => {
    toastTimersRef.current.add(t);
    return t;
  }, []);

  // ── Toast helpers ────────────────────────────────────────────────────

  const dismissToast = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      toasts: prev.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    const t = setTimeout(() => {
      toastTimersRef.current.delete(t);
      setState((prev) => ({
        ...prev,
        toasts: prev.toasts.filter((t) => t.id !== id),
      }));
    }, 300);
    toastTimersRef.current.add(t);
  }, []);

  const addToast = useCallback(
    (message: string, type: CollabToast['type'] = 'info') => {
      const id = Date.now().toString() + Math.random().toString(36).substring(2);
      setState((prev) => ({
        ...prev,
        toasts: [...prev.toasts.slice(-4), { id, message, type }],
      }));
      const t = setTimeout(() => {
        toastTimersRef.current.delete(t);
        dismissToast(id);
      }, 4000);
      toastTimersRef.current.add(t);
    },
    [dismissToast],
  );

  // ── Build a fresh events bundle each call (closes over up-to-date setters) ──
  const buildEvents = useCallback(
    (): CollabEvents => ({
      onStatusChange: (status) => {
        const prov = providerRef.current;
        setState((prev) => ({
          ...prev,
          status,
          // OR, not replace: createRoom optimistically sets isHost before the
          // provider learns it from 'room-created' — a plain replace clobbered
          // it back to false for the whole connecting window.
          isHost: (prov?.isHost ?? false) || prev.isHost,
          peerId: prov?.peerId ?? prev.peerId,
        }));
      },
      onMembersUpdate: (members, pending) =>
        setState((prev) => ({ ...prev, members, pending })),
      onJoinRequest: (req) => addToast(`${req.displayName} wants to join`, 'info'),
      onPeerLeft: (_pid, name) => addToast(`${name} left the room`, 'warning'),
      onPromotedToHost: () => {
        setState((prev) => ({ ...prev, isHost: true }));
        addToast('You are now the host', 'success');
      },
      onError: (msg) => {
        const prov = providerRef.current;
        const m = msg.toLowerCase();
        // Room-level join failures surface inline in the join modal
        // (capacity errors included — they were toast-only before).
        const isRoomLevelError =
          m.includes('does not exist') ||
          m.includes('locked') ||
          m.includes('full') ||
          m.includes('capacity') ||
          m.includes('pending join requests');

        if (prov && !prov.isHost && isRoomLevelError) {
          setJoinError(msg);
          prov.destroy();
          providerRef.current = null;
          setState((prev) => ({
            ...prev,
            status: 'disconnected',
            roomId: null,
            isHost: false,
            members: [],
            pending: [],
            sharedFiles: [],
            provider: null,
          }));
          return;
        }

        addToast(msg, 'error');
        // A create/join that never completes (e.g. 'Room already exists',
        // capacity) must not leave the host stuck in 'connecting' forever.
        const isConnecting = prov ? prov.status === 'connecting' : false;
        if (prov && (!prov.isHost || isConnecting)) {
          if (prov.isHost && isConnecting) setJoinError(msg);
          prov.destroy();
          providerRef.current = null;
          setState((prev) => ({
            ...prev,
            status: 'disconnected',
            roomId: null,
            isHost: false,
            members: [],
            pending: [],
            sharedFiles: [],
            provider: null,
          }));
        }
      },
      onRoomClosed: () => {
        addToast('Room was closed by the host', 'error');
        // Destroy the provider so the control socket actually closes — the
        // server signals room-closed but may leave the socket open.
        providerRef.current?.destroy();
        providerRef.current = null;
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          roomId: null,
          isHost: false,
          members: [],
          pending: [],
          sharedFiles: [],
          provider: null,
        }));
      },
      onFileShared: (file) => {
        setState((prev) => {
          if (prev.sharedFiles.some((f) => f.id === file.id)) return prev;
          return { ...prev, sharedFiles: [...prev.sharedFiles, file] };
        });
        addToast(`"${file.name}" added to collab`, 'info');
      },
      onFileUnshared: (fileId) => {
        setState((prev) => ({
          ...prev,
          sharedFiles: prev.sharedFiles.filter((f) => f.id !== fileId),
        }));
        addToast('File removed from collab', 'warning');
      },
      onFilesReordered: (sharedFiles) =>
        setState((prev) => ({ ...prev, sharedFiles })),
      onApproved: (sharedFiles) => {
        setState((prev) => ({ ...prev, sharedFiles }));
        addToast('You joined the room!', 'success');
      },
      onChatMessage: (message) =>
        setState((prev) => {
          // Cap the in-memory history; nothing virtualizes this list.
          const chatMessages = [...prev.chatMessages, message];
          return { ...prev, chatMessages: chatMessages.slice(-200) };
        }),
      onConnectionLost: () => {
        addToast('Lost connection to collab server. Please rejoin.', 'error');
        providerRef.current?.destroy();
        providerRef.current = null;
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          roomId: null,
          isHost: false,
          isLocked: false,
          followingPeerId: null,
          members: [],
          pending: [],
          sharedFiles: [],
          provider: null,
          peerId: '',
        }));
      },
      onKicked: () => {
        addToast('You were kicked from the room by the host.', 'error');
        providerRef.current?.destroy();
        providerRef.current = null;
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          roomId: null,
          isHost: false,
          isLocked: false,
          members: [],
          pending: [],
          sharedFiles: [],
          provider: null,
          chatMessages: [],
          peerId: '',
        }));
      },
      onRoomLocked: (locked) => {
        setState((prev) => ({ ...prev, isLocked: locked }));
        addToast(locked ? 'Room is now locked' : 'Room is now open', 'info');
      },
    }),
    [addToast],
  );

  const createRoom = useCallback(
    (displayName: string, roomId: string) => {
      providerRef.current?.destroy();
      const color = getRandomColor();
      const provider = new CollabProvider(roomId, displayName, color, buildEvents());
      providerRef.current = provider;
      setState((prev) => ({
        ...prev,
        roomId,
        displayName,
        color,
        provider,
        isHost: true,
        isLocked: false,
        status: 'connecting',
        members: [],
        pending: [],
        sharedFiles: [],
        chatMessages: [],
        peerId: '',
      }));
      provider.connect();
      provider.createRoom();
      // Remember for the reconnect hint after a refresh.
      try {
        sessionStorage.setItem('collabify-last-room', roomId);
      } catch {
        /* ignore */
      }
    },
    [buildEvents],
  );

  const joinRoom = useCallback(
    (displayName: string, roomId: string) => {
      providerRef.current?.destroy();
      setJoinError(null);
      const color = getRandomColor();
      const provider = new CollabProvider(roomId, displayName, color, buildEvents());
      providerRef.current = provider;
      setState((prev) => ({
        ...prev,
        roomId,
        displayName,
        color,
        provider,
        isHost: false,
        isLocked: false,
        status: 'connecting',
        members: [],
        pending: [],
        sharedFiles: [],
        chatMessages: [],
        peerId: '',
      }));
      provider.connect();
      provider.joinRoom();
    },
    [buildEvents],
  );

  const leaveRoom = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      status: 'disconnected',
      roomId: null,
      isHost: false,
      isLocked: false,
      members: [],
      pending: [],
      sharedFiles: [],
      provider: null,
      chatMessages: [],
      peerId: '',
    }));
  }, []);

  const approveJoin = useCallback((peerId: string) => {
    providerRef.current?.approveJoin(peerId);
  }, []);

  const rejectJoin = useCallback((peerId: string) => {
    providerRef.current?.rejectJoin(peerId);
  }, []);

  const shareFile = useCallback(
    (file: { id: string; name: string; language: string; content: string }) => {
      providerRef.current?.shareFile(file);
    },
    [],
  );

  const unshareFile = useCallback((fileId: string) => {
    providerRef.current?.unshareFile(fileId);
  }, []);

  const reorderFiles = useCallback((files: SharedFileInfo[]) => {
    providerRef.current?.reorderFiles(files);
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    providerRef.current?.sendChatMessage(text);
  }, []);

  const kickMember = useCallback((peerId: string) => {
    providerRef.current?.kickMember(peerId);
  }, []);

  const lockRoom = useCallback((locked: boolean) => {
    providerRef.current?.lockRoom(locked);
  }, []);

  const setFollowingPeer = useCallback((peerId: string | null) => {
    setState((prev) => ({ ...prev, followingPeerId: peerId }));
  }, []);

  useEffect(() => {
    return () => {
      for (const t of toastTimersRef.current) clearTimeout(t);
      toastTimersRef.current.clear();
      providerRef.current?.destroy();
    };
  }, []);

  return {
    ...state,
    setFollowingPeer,
    joinError,
    clearJoinError: useCallback(() => setJoinError(null), []),
    createRoom,
    joinRoom,
    leaveRoom,
    approveJoin,
    rejectJoin,
    shareFile,
    unshareFile,
    reorderFiles,
    dismissToast,
    sendChatMessage,
    kickMember,
    lockRoom,
  };
}
