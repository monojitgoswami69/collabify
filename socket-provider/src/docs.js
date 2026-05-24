// DocRegistry — owns Y.Docs (one per shared file) and their connected sockets.
// Tracks awareness client IDs per connection so they can be reaped on disconnect.

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { DOC_GC_DELAY_MS } from './constants.js';
import { log } from './log.js';

export class DocRegistry {
  constructor() {
    /** @type {Map<string, DocEntry>} */
    this.docs = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._gcTimers = new Map();
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
    awareness.setLocalState(null);

    entry = {
      docName,
      doc,
      awareness,
      conns: new Map(), // ws -> Set<clientID>
    };
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

  /** Register a new connection on a document. */
  attach(docName, ws) {
    const entry = this.getOrCreate(docName);
    entry.conns.set(ws, new Set());
    return entry;
  }

  /** Detach a single connection from a doc; schedules GC when the last leaves. */
  detach(docName, ws) {
    const entry = this.docs.get(docName);
    if (!entry) return;

    const controlledIds = entry.conns.get(ws);
    entry.conns.delete(ws);

    if (controlledIds && controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        entry.awareness,
        Array.from(controlledIds),
        null,
      );
    }

    if (entry.conns.size === 0) {
      this._scheduleGc(docName);
    }
  }

  /** Immediately destroy a doc, kicking all clients. */
  destroy(docName) {
    const entry = this.docs.get(docName);
    if (!entry) return;
    this._cancelGc(docName);

    for (const [conn] of entry.conns) {
      try { conn.close(1000, 'doc-removed'); } catch {}
    }
    entry.awareness.destroy();
    entry.doc.destroy();
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

  _scheduleGc(docName) {
    this._cancelGc(docName);
    const timer = setTimeout(() => {
      const entry = this.docs.get(docName);
      if (entry && entry.conns.size === 0) {
        entry.awareness.destroy();
        entry.doc.destroy();
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
 *   conns: Map<import('ws').WebSocket, Set<number>>
 * }} DocEntry */
