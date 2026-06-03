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

  // ── Toast helpers ────────────────────────────────────────────────────

  const dismissToast = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      toasts: prev.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        toasts: prev.toasts.filter((t) => t.id !== id),
      }));
    }, 300);
  }, []);

  const addToast = useCallback(
    (message: string, type: CollabToast['type'] = 'info') => {
      const id = Date.now().toString() + Math.random().toString(36).substring(2);
      setState((prev) => ({
        ...prev,
        toasts: [...prev.toasts.slice(-4), { id, message, type }],
      }));
      setTimeout(() => dismissToast(id), 4000);
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
          isHost: prov?.isHost ?? prev.isHost,
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
        const isRoomNotFound = msg.toLowerCase().includes('does not exist');

        if (prov && !prov.isHost && isRoomNotFound) {
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
        if (prov && !prov.isHost) {
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
        setState((prev) => ({ ...prev, chatMessages: [...prev.chatMessages, message] })),
      onConnectionLost: () => {
        addToast('Lost connection to collab server. Please rejoin.', 'error');
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
          peerId: '',
        }));
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
        status: 'connecting',
        members: [],
        pending: [],
        sharedFiles: [],
        chatMessages: [],
        peerId: '',
      }));
      provider.connect();
      provider.createRoom();
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

  useEffect(() => {
    return () => {
      providerRef.current?.destroy();
    };
  }, []);

  return {
    ...state,
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
  };
}
