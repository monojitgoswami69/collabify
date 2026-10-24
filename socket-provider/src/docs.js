// DocRegistry — owns Y.Docs (one per shared file) and their connected sockets.
// A single doc/awareness listener is registered when the doc is created; it
// fans every update out to every connection except the origin. Connection
// teardown is responsible for un-attaching only — handler lifecycle follows
// the doc, not the socket.
//
// Each attached socket records its owner key (the per-member doc token), so a
// member's document access can be revoked wholesale on kick/leave — see
// `detachOwner`.

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { MSG_SYNC, MSG_AWARENESS, DOC_GC_DELAY_MS, CLOSE } from './constants.js';
import { sendBinary } from './util.js';
import { log } from './log.js';

function broadcastExcept(entry, payload, origin) {
  for (const conn of entry.conns.keys()) {
    if (conn !== origin) sendBinary(conn, payload);
  }
}

export class DocRegistry {
  constructor() {
    /** @type {Map<string, DocEntry>} */
    this.docs = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._gcTimers = new Map();
    /** ownerKey -> Set<ws> — live sockets opened with that owner key. */
    /** @type {Map<string, Set<import('ws').WebSocket>>} */
    this._owners = new Map();
  }

  /**
   * Get-or-create a DocEntry. Cancels any pending GC.
   * @param {string} docName e.g. "ROOMID/fileId"
   */
  getOrCreate(docName) {
    let entry = this.docs.get(docName);
    if (entry) {
      this._cancelGc(docName);
      return entry;
    }

    const doc = new Y.Doc({ gc: true });
    const awareness = new awarenessProtocol.Awareness(doc);
    // The server itself never publishes awareness — drop the implicit
    // local state so it isn't broadcast as a phantom peer.
    awareness.setLocalState(null);

    /** @type {DocEntry} */
    entry = {
      docName,
      doc,
      awareness,
      // ws -> { awarenessIds: Set<clientID>, ownerKey: string }
      conns: new Map(),
    };

    // ── Fan-out listeners (registered once per doc) ──────────────────────
    entry._docUpdateHandler = (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      broadcastExcept(entry, encoding.toUint8Array(encoder), origin);
    };
    entry._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      const conn = origin && entry.conns.has(origin) ? entry.conns.get(origin) : null;
      if (conn) {
        for (const id of added) conn.awarenessIds.add(id);
        for (const id of updated) conn.awarenessIds.add(id);
        for (const id of removed) conn.awarenessIds.delete(id);
      }
      const total = added.length + updated.length + removed.length;
      if (total === 0) return;

      const changed = new Array(total);
      let i = 0;
      for (const id of added) changed[i++] = id;
      for (const id of updated) changed[i++] = id;
      for (const id of removed) changed[i++] = id;

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      broadcastExcept(entry, encoding.toUint8Array(encoder), origin);
    };
    doc.on('update', entry._docUpdateHandler);
    awareness.on('update', entry._awarenessUpdateHandler);

    this.docs.set(docName, entry);
    log.debug('docs', `created ${docName}`);
    return entry;
  }

  has(docName) {
    return this.docs.has(docName);
  }

  get(docName) {
    return this.docs.get(docName);
  }

  /** Initialize the Y.Text 'monaco' with seed content, if currently empty. */
  seed(docName, content) {
    const entry = this.getOrCreate(docName);
    const ytext = entry.doc.getText('monaco');
    if (ytext.length === 0 && content) {
      ytext.insert(0, content);
    }
    return entry;
  }

  /**
   * Register a new connection on a document. `ownerKey` (the member's doc
   * token) indexes the socket for revocation via detachOwner.
   */
  attach(docName, ws, ownerKey) {
    const entry = this.getOrCreate(docName);
    entry.conns.set(ws, { awarenessIds: new Set(), ownerKey });
    let set = this._owners.get(ownerKey);
    if (!set) {
      set = new Set();
      this._owners.set(ownerKey, set);
    }
    set.add(ws);
    return entry;
  }

  /** Detach a single connection from a doc; schedules GC when the last leaves. */
  detach(docName, ws) {
    const entry = this.docs.get(docName);
    if (!entry) return;

    const conn = entry.conns.get(ws);
    entry.conns.delete(ws);
    if (conn) {
      if (conn.awarenessIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(
          entry.awareness,
          Array.from(conn.awarenessIds),
          null,
        );
      }
      const ownerSet = this._owners.get(conn.ownerKey);
      if (ownerSet) {
        ownerSet.delete(ws);
        if (ownerSet.size === 0) this._owners.delete(conn.ownerKey);
      }
    }

    if (entry.conns.size === 0) {
      this._scheduleGc(docName);
    }
  }

  /**
   * Revoke every doc socket opened with `ownerKey` (a member's doc token):
   * detach and close them. Used when a member is kicked or disconnects, so
   * removed members lose document access immediately.
   */
  detachOwner(ownerKey) {
    const set = this._owners.get(ownerKey);
    if (!set) return;
    this._owners.delete(ownerKey);
    for (const ws of set) {
      for (const [docName, entry] of this.docs) {
        if (entry.conns.has(ws)) this.detach(docName, ws);
      }
      try { ws.close(CLOSE.POLICY_VIOLATION, 'membership-revoked'); } catch {}
    }
  }

  /** Immediately destroy a doc, kicking all clients. */
  destroy(docName) {
    const entry = this.docs.get(docName);
    if (!entry) return;
    this._cancelGc(docName);

    for (const conn of entry.conns.keys()) {
      try { conn.close(CLOSE.NORMAL, 'doc-removed'); } catch {}
    }
    this._teardown(entry);
    this.docs.delete(docName);
    log.debug('docs', `destroyed ${docName}`);
  }

  /** Destroy every doc whose name begins with the given prefix (e.g. roomId + '/'). */
  destroyByPrefix(prefix) {
    for (const docName of Array.from(this.docs.keys())) {
      if (docName.startsWith(prefix)) this.destroy(docName);
    }
  }

  count() {
    return this.docs.size;
  }

  _teardown(entry) {
    if (entry._docUpdateHandler) {
      entry.doc.off('update', entry._docUpdateHandler);
    }
    if (entry._awarenessUpdateHandler) {
      entry.awareness.off('update', entry._awarenessUpdateHandler);
    }
    entry.awareness.destroy();
    entry.doc.destroy();
  }

  _scheduleGc(docName) {
    this._cancelGc(docName);
    const timer = setTimeout(() => {
      const entry = this.docs.get(docName);
      if (entry && entry.conns.size === 0) {
        this._teardown(entry);
        this.docs.delete(docName);
        log.debug('docs', `gc destroyed ${docName}`);
      }
      this._gcTimers.delete(docName);
    }, DOC_GC_DELAY_MS);
    this._gcTimers.set(docName, timer);
  }

  _cancelGc(docName) {
    const t = this._gcTimers.get(docName);
    if (t) {
      clearTimeout(t);
      this._gcTimers.delete(docName);
    }
  }
}

/** @typedef {{
 *   docName: string,
 *   doc: import('yjs').Doc,
 *   awareness: import('y-protocols/awareness').Awareness,
 *   conns: Map<import('ws').WebSocket, { awarenessIds: Set<number>, ownerKey: string }>,
 *   _docUpdateHandler?: (update: Uint8Array, origin: unknown) => void,
 *   _awarenessUpdateHandler?: (info: { added: number[], updated: number[], removed: number[] }, origin: unknown) => void
 * }} DocEntry */
