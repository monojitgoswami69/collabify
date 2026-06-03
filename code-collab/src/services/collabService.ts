// CollabService — WebSocket client for the socket-provider.
// Two channels per room:
//   /room/:roomId           — JSON control (room lifecycle, file mgmt, chat)
//   /doc/:roomId/:fileId    — Binary Yjs sync + awareness

import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from 'y-protocols/awareness.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export interface CollabMember {
  peerId: string;
  displayName: string;
  color: string;
  isHost: boolean;
}

export interface PendingRequest {
  peerId: string;
  displayName: string;
  color: string;
}

export interface SharedFileInfo {
  id: string;
  name: string;
  language: string;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  displayName: string;
  color: string;
  text: string;
  timestamp: number;
}

export type CollabStatus =
  | 'disconnected'
  | 'connecting'
  | 'waiting-approval'
  | 'connected'
  | 'rejected'
  | 'error';

export interface CollabEvents {
  onStatusChange: (status: CollabStatus) => void;
  onMembersUpdate: (members: CollabMember[], pending: PendingRequest[]) => void;
  onJoinRequest: (request: PendingRequest) => void;
  onPeerLeft: (peerId: string, displayName: string) => void;
  onPromotedToHost: () => void;
  onError: (message: string) => void;
  onRoomClosed: () => void;
  onFileShared: (file: SharedFileInfo) => void;
  onFileUnshared: (fileId: string) => void;
  onFilesReordered: (sharedFiles: SharedFileInfo[]) => void;
  onApproved: (sharedFiles: SharedFileInfo[]) => void;
  onChatMessage: (message: ChatMessage) => void;
  /** Fired when the control socket closes without `destroy()` being called. */
  onConnectionLost: () => void;
}

export const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F1948A', '#82E0AA', '#F0B27A', '#AED6F1',
];

export function getRandomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

function buildWsUrl(path: string): string {
  const collabUrl = (process.env.NEXT_PUBLIC_COLLAB_URL || '').trim().replace(/\/+$/, '');
  if (collabUrl) {
    const wsBase = collabUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    return `${wsBase}${path}`;
  }
  // Same-origin fallback (rarely used — typically NEXT_PUBLIC_COLLAB_URL is set in both dev and prod)
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${path}`;
  }
  return `ws://localhost:4000${path}`;
}

// ─── DocConnection — per-file Yjs sync ─────────────────────────────────

// Close codes the server uses for intentional teardown. Reconnecting after
// these would just re-trigger the same rejection in a tight loop. Mirror of
// socket-provider/src/constants.js CLOSE — keep in sync.
const CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  FILE_UNSHARED: 4001,
} as const;
const NO_RETRY_CODES = new Set<number>([
  CLOSE.NORMAL,
  CLOSE.GOING_AWAY,
  CLOSE.FILE_UNSHARED,
]);

export class DocConnection {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly fileId: string;
  private ws: WebSocket | null = null;
  private _destroyed = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempt = 0;
  private _roomId = '';
  private _displayName = '';
  private _color = '';

  constructor(fileId: string) {
    this.fileId = fileId;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
  }

  connect(roomId: string, displayName: string, color: string) {
    if (this._destroyed) return;
    this._roomId = roomId;
    this._displayName = displayName;
    this._color = color;

    this.awareness.setLocalStateField('user', { name: displayName, color });
    this.doc.on('update', this._onDocUpdate);
    this.awareness.on('update', this._onAwarenessUpdate);
    this._openSocket();
  }

  private _openSocket() {
    if (this._destroyed) return;
    const wsUrl = buildWsUrl(
      `/doc/${encodeURIComponent(this._roomId)}/${encodeURIComponent(this.fileId)}`,
    );
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this._reconnectAttempt = 0;
      // Initial sync handshake
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      ws.send(encoding.toUint8Array(encoder));

      // Re-send our awareness so other peers see us after reconnect.
      const localState = this.awareness.getLocalState();
      if (localState) {
        const awEncoder = encoding.createEncoder();
        encoding.writeVarUint(awEncoder, MSG_AWARENESS);
        encoding.writeVarUint8Array(
          awEncoder,
          encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        ws.send(encoding.toUint8Array(awEncoder));
      }
    };

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      this._handleMessage(new Uint8Array(event.data));
    };

    ws.onclose = (event) => {
      if (this._destroyed) return;
      if (NO_RETRY_CODES.has(event.code)) return;
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  private _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    const backoff = Math.min(1000 * Math.pow(2, this._reconnectAttempt++), 15_000);
    this._reconnectTimer = setTimeout(() => {
      if (!this._destroyed) this._openSocket();
    }, backoff);
  }

  private _handleMessage(data: Uint8Array) {
    try {
      const decoder = decoding.createDecoder(data);
      const msgType = decoding.readVarUint(decoder);
      switch (msgType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1) {
            this._sendBinary(encoding.toUint8Array(encoder));
          }
          break;
        }
        case MSG_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          applyAwarenessUpdate(this.awareness, update, this);
          break;
        }
      }
    } catch {
      // Malformed payload — ignore
    }
  }

  private _onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // server-applied update — don't echo

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this._sendBinary(encoding.toUint8Array(encoder));
  };

  private _onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    // Skip echoes of remote awareness we just applied (origin === this) and
    // skip local-only events that don't touch our own state — e.g. the
    // periodic timeout reaper firing for a stale remote peer.
    if (origin === this) return;
    const localId = this.doc.clientID;
    if (
      !added.includes(localId) &&
      !updated.includes(localId) &&
      !removed.includes(localId)
    ) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, [localId]),
    );
    this._sendBinary(encoding.toUint8Array(encoder));
  };

  private _sendBinary(data: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);
    if (this.ws) {
      try { this.ws.close(CLOSE.NORMAL, 'client-destroy'); } catch {}
      this.ws = null;
    }
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// ─── CollabProvider — control channel ──────────────────────────────────

export class CollabProvider {
  readonly roomId: string;
  readonly displayName: string;
  readonly color: string;

  private ws: WebSocket | null = null;
  private events: CollabEvents;
  private _status: CollabStatus = 'disconnected';
  private _isHost = false;
  private _peerId = '';
  private _destroyed = false;
  private _pendingMessages: string[] = [];
  private _opened = false;

  readonly docConnections: Map<string, DocConnection> = new Map();

  constructor(roomId: string, displayName: string, color: string, events: CollabEvents) {
    this.roomId = roomId;
    this.displayName = displayName;
    this.color = color;
    this.events = events;
  }

  get status() { return this._status; }
  get isHost() { return this._isHost; }
  get peerId() { return this._peerId; }

  connect() {
    if (this._destroyed) return;
    this._setStatus('connecting');

    const wsUrl = buildWsUrl(`/room/${encodeURIComponent(this.roomId)}`);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this._opened = true;
      for (const msg of this._pendingMessages) ws.send(msg);
      this._pendingMessages = [];
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        this._handleJsonMessage(msg);
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      this._opened = false;
      const wasConnected = this._status === 'connected' || this._status === 'waiting-approval';
      if (this._status !== 'rejected' && this._status !== 'error') {
        this._setStatus('disconnected');
      }
      if (wasConnected && !this._destroyed) {
        this.events.onConnectionLost();
      }
    };

    ws.onerror = () => {
      this.events.onError('Connection to collab server failed.');
      this._setStatus('error');
    };
  }

  createRoom() {
    this._sendJson({ type: 'create', displayName: this.displayName, color: this.color });
  }

  joinRoom() {
    this._sendJson({ type: 'join', displayName: this.displayName, color: this.color });
  }

  approveJoin(peerId: string) {
    this._sendJson({ type: 'approve', peerId });
  }

  rejectJoin(peerId: string) {
    this._sendJson({ type: 'reject', peerId });
  }

  shareFile(file: { id: string; name: string; language: string; content: string }) {
    this._sendJson({ type: 'share-file', file });
  }

  reorderFiles(files: SharedFileInfo[]) {
    this._sendJson({ type: 'reorder-files', files });
  }

  unshareFile(fileId: string) {
    this._sendJson({ type: 'unshare-file', fileId });
    const conn = this.docConnections.get(fileId);
    if (conn) {
      conn.destroy();
      this.docConnections.delete(fileId);
    }
  }

  sendChatMessage(text: string) {
    this._sendJson({ type: 'chat-message', text });
  }

  openFileConnection(fileId: string): DocConnection {
    let conn = this.docConnections.get(fileId);
    if (conn) return conn;
    conn = new DocConnection(fileId);
    conn.connect(this.roomId, this.displayName, this.color);
    this.docConnections.set(fileId, conn);
    return conn;
  }

  closeFileConnection(fileId: string) {
    const conn = this.docConnections.get(fileId);
    if (conn) {
      conn.destroy();
      this.docConnections.delete(fileId);
    }
  }

  disconnect() {
    for (const conn of this.docConnections.values()) conn.destroy();
    this.docConnections.clear();
    if (this.ws) {
      if (this._opened) {
        try { this.ws.send(JSON.stringify({ type: 'leave' })); } catch {}
      }
      try { this.ws.close(CLOSE.NORMAL, 'client-leave'); } catch {}
      this.ws = null;
    }
    this._opened = false;
    this._setStatus('disconnected');
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.disconnect();
  }

  private _handleJsonMessage(msg: { type: string; [k: string]: unknown }) {
    switch (msg.type) {
      case 'room-created':
        this._peerId = (msg.peerId as string) || '';
        this._isHost = true;
        this._setStatus('connected');
        break;

      case 'waiting-approval':
        this._peerId = (msg.peerId as string) || '';
        this._setStatus('waiting-approval');
        break;

      case 'approved':
        this._peerId = (msg.peerId as string) || '';
        this._setStatus('connected');
        this.events.onApproved((msg.sharedFiles as SharedFileInfo[]) || []);
        break;

      case 'rejected':
        this._setStatus('rejected');
        this.events.onError('Your join request was rejected by the host.');
        break;

      case 'room-closed':
        this.events.onRoomClosed();
        this._setStatus('disconnected');
        break;

      case 'members-update':
        this.events.onMembersUpdate(
          (msg.members as CollabMember[]) || [],
          (msg.pending as PendingRequest[]) || [],
        );
        break;

      case 'join-request':
        this.events.onJoinRequest({
          peerId: msg.peerId as string,
          displayName: msg.displayName as string,
          color: msg.color as string,
        });
        break;

      case 'peer-left':
        this.events.onPeerLeft(msg.peerId as string, msg.displayName as string);
        break;

      case 'promoted-to-host':
        this._isHost = true;
        this.events.onPromotedToHost();
        break;

      case 'file-shared':
        this.events.onFileShared(msg.file as SharedFileInfo);
        break;

      case 'file-unshared':
        this.closeFileConnection(msg.fileId as string);
        this.events.onFileUnshared(msg.fileId as string);
        break;

      case 'files-reordered':
        this.events.onFilesReordered((msg.sharedFiles as SharedFileInfo[]) || []);
        break;

      case 'chat-message':
        this.events.onChatMessage({
          id: msg.id as string,
          peerId: msg.peerId as string,
          displayName: msg.displayName as string,
          color: msg.color as string,
          text: msg.text as string,
          timestamp: msg.timestamp as number,
        });
        break;

      case 'error':
        this.events.onError((msg.message as string) || 'Unknown error');
        this._setStatus('error');
        break;
    }
  }

  private _sendJson(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this._pendingMessages.push(data);
    }
  }

  private _setStatus(status: CollabStatus) {
    this._status = status;
    this.events.onStatusChange(status);
  }
}
