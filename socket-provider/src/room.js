// Room — in-memory state for a single collab room.
// Membership: members vs. pending join requests.

import { WebSocket } from 'ws';
import { OUT } from './constants.js';
import { sendJson } from './util.js';

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
  }

  // ── Membership ────────────────────────────────────────────────────────

  addHost(peerId, ws, displayName, color) {
    this.hostId = peerId;
    this.members.set(peerId, { ws, displayName, color });
  }

  addPending(peerId, ws, displayName, color) {
    this.pending.set(peerId, { ws, displayName, color });
  }

  approve(peerId) {
    const m = this.pending.get(peerId);
    if (!m) return null;
    this.pending.delete(peerId);
    this.members.set(peerId, m);
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

  // ── Snapshots ─────────────────────────────────────────────────────────

  getMembersList() {
    return Array.from(this.members.entries()).map(([peerId, m]) => ({
      peerId,
      displayName: m.displayName,
      color: m.color,
      isHost: peerId === this.hostId,
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
    const data = JSON.stringify(msg);
    for (const [pid, member] of this.members) {
      if (pid !== excludePeerId && member.ws.readyState === WebSocket.OPEN) {
        try { member.ws.send(data); } catch {}
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

  /** Replace shared-file ordering by an explicit id list (only keeps known ids). */
  reorderSharedFiles(fileList) {
    const oldMap = this.sharedFiles;
    const newMap = new Map();
    for (const f of fileList) {
      const existing = oldMap.get(f.id);
      if (existing) newMap.set(f.id, existing);
    }
    this.sharedFiles = newMap;
  }
}

/** @typedef {{ ws: import('ws').WebSocket, displayName: string, color: string }} Member */
/** @typedef {{ id: string, name: string, language: string, content: string }} SharedFile */
