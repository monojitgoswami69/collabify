// Room — in-memory state for a single collab room.
// Membership: members vs. pending join requests.
//
// Doc access: every approved member (and the host) holds a per-member doc
// token, delivered over the control channel and required by /doc connections.
// Revoking a member (kick / disconnect) revokes their token and closes their
// doc sockets — see DocRegistry.detachOwner.

import { randomBytes } from 'node:crypto';
import { OUT } from './constants.js';
import { sendJson } from './util.js';

/** Cryptographically random per-member doc capability. */
export function newDocToken() {
  return randomBytes(24).toString('base64url');
}

export class Room {
  /**
   * @param {string} roomId
   */
  constructor(roomId) {
    this.roomId = roomId;
    this.hostId = null;
    this.locked = false;

    /** @type {Map<string, Member>} */
    this.members = new Map();
    /** @type {Map<string, Member>} */
    this.pending = new Map();
    /** Insertion-ordered map of shared file metadata + seed content. */
    /** @type {Map<string, SharedFile>} */
    this.sharedFiles = new Map();
    /** peerId -> per-member doc token (revoked on kick/leave). */
    /** @type {Map<string, string>} */
    this.docTokens = new Map();
  }

  // ── Membership ────────────────────────────────────────────────────────

  addHost(peerId, ws, displayName, color) {
    this.hostId = peerId;
    this.members.set(peerId, { ws, displayName, color });
    this.docTokens.set(peerId, newDocToken());
  }

  addPending(peerId, ws, displayName, color) {
    this.pending.set(peerId, { ws, displayName, color });
  }

  approve(peerId) {
    const m = this.pending.get(peerId);
    if (!m) return null;
    this.pending.delete(peerId);
    this.members.set(peerId, m);
    this.docTokens.set(peerId, newDocToken());
    return m;
  }

  removePending(peerId) {
    const m = this.pending.get(peerId);
    if (m) this.pending.delete(peerId);
    return m || null;
  }

  removeMember(peerId) {
    const m = this.members.get(peerId);
    if (m) this.members.delete(peerId);
    return m || null;
  }

  hasMember(peerId) {
    return this.members.has(peerId);
  }

  isHost(peerId) {
    return peerId === this.hostId;
  }

  /** Promote the next eligible member to host. Returns the new host peerId or null. */
  promoteNextHost() {
    const next = this.members.keys().next();
    if (next.done) return null;
    this.hostId = next.value;
    return next.value;
  }

  // ── Doc tokens ────────────────────────────────────────────────────────

  docTokenOf(peerId) {
    return this.docTokens.get(peerId) || null;
  }

  revokeDocToken(peerId) {
    this.docTokens.delete(peerId);
  }

  /** Does this token currently belong to a member? @returns {boolean} */
  hasDocToken(token) {
    for (const t of this.docTokens.values()) {
      if (t === token) return true;
    }
    return false;
  }

  // ── Snapshots ─────────────────────────────────────────────────────────

  getMembersList() {
    return Array.from(this.members.entries()).map(([peerId, m]) => ({
      peerId,
      displayName: m.displayName,
      color: m.color,
      isHost: peerId === this.hostId,
      ...(m.currentFileId ? { currentFileId: m.currentFileId } : {}),
    }));
  }

  getPendingList() {
    return Array.from(this.pending.entries()).map(([peerId, p]) => ({
      peerId,
      displayName: p.displayName,
      color: p.color,
    }));
  }

  getSharedFilesList() {
    return Array.from(this.sharedFiles.values()).map((f) => ({
      id: f.id,
      name: f.name,
      language: f.language,
    }));
  }

  // ── Broadcast ─────────────────────────────────────────────────────────

  broadcastJson(msg, excludePeerId = null) {
    for (const [pid, member] of this.members) {
      if (pid !== excludePeerId) {
        // sendJson applies the readyState check AND the stalled-consumer
        // guard — a raw ws.send here let a paused member buffer broadcasts
        // without bound.
        sendJson(member.ws, msg);
      }
    }
  }

  broadcastMembersUpdate() {
    this.broadcastJson({
      type: OUT.MEMBERS_UPDATE,
      members: this.getMembersList(),
      pending: this.getPendingList(),
    });
  }

  /** Send a JSON message to a single peer. */
  sendTo(peerId, msg) {
    const m = this.members.get(peerId) || this.pending.get(peerId);
    if (m) sendJson(m.ws, msg);
  }

  // ── File metadata ─────────────────────────────────────────────────────

  addSharedFile(file) {
    this.sharedFiles.set(file.id, file);
  }

  removeSharedFile(fileId) {
    return this.sharedFiles.delete(fileId);
  }

  hasSharedFile(fileId) {
    return this.sharedFiles.has(fileId);
  }

  /**
   * Apply an explicit ordering to the shared files. Ordering only — files
   * missing from the list are KEPT (appended in their previous order):
   * removal is unshare-file's job. Treating the client list as authoritative
   * for removal made a reorder racing a just-shared file's echo destroy the
   * new file and its doc. Invalid entries (non-objects / non-string ids) are
   * skipped, never dereferenced — a null element here once crashed the
   * whole process.
   * @param {unknown} fileList
   */
  reorderSharedFiles(fileList) {
    const oldMap = this.sharedFiles;
    const newMap = new Map();
    for (const f of fileList) {
      if (typeof f !== 'object' || f === null) continue;
      const id = f.id;
      if (typeof id !== 'string') continue;
      const existing = oldMap.get(id);
      if (existing && !newMap.has(id)) newMap.set(id, existing);
    }
    for (const [id, existing] of oldMap) {
      if (!newMap.has(id)) newMap.set(id, existing);
    }
    this.sharedFiles = newMap;
  }
}

/** @typedef {{ ws: import('ws').WebSocket, displayName: string, color: string }} Member */
/** @typedef {{ id: string, name: string, language: string }} SharedFile */
