// Yjs doc channel handler — binary messages over /doc/:roomId/:fileId.
//
// One awareness instance + one Y.Doc per shared file. Each connecting client gets:
//   1. SyncStep1 sent immediately so they request our state.
//   2. The current awareness snapshot so they see existing peers.
//   3. A subscription that fans out local doc/awareness updates to peers.

import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MSG_SYNC, MSG_AWARENESS } from './constants.js';
import { sendBinary } from './util.js';
import { log } from './log.js';

/**
 * @param {object} deps
 * @param {Map<string, import('./room.js').Room>} deps.rooms
 * @param {import('./docs.js').DocRegistry} deps.docs
 */
export function createDocHandler({ rooms, docs }) {
  /**
   * @param {import('ws').WebSocket} ws
   * @param {string} roomId
   * @param {string} fileId
   */
  return function handleDocConnection(ws, roomId, fileId) {
    const docName = `${roomId}/${fileId}`;
    const room = rooms.get(roomId);
    if (!room || !room.hasSharedFile(fileId)) {
      try { ws.close(4001, 'File not shared'); } catch {}
      return;
    }

    const entry = docs.attach(docName, ws);
    const { doc, awareness, conns } = entry;

    // 1. Send initial sync request.
    {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      sendBinary(ws, encoding.toUint8Array(encoder));
    }

    // 2. Send a snapshot of current awareness so the new peer sees existing cursors.
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      sendBinary(ws, encoding.toUint8Array(encoder));
    }

    // Track which awareness client IDs originate from this connection.
    // We do this via the `update` event with origin === ws (set during applyAwarenessUpdate).
    const awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      // Update ID tracking for the originating connection
      if (origin && conns.has(origin)) {
        const tracked = conns.get(origin);
        for (const id of added) tracked.add(id);
        for (const id of updated) tracked.add(id);
        for (const id of removed) tracked.delete(id);
      }

      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length === 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
      );
      const out = encoding.toUint8Array(encoder);

      for (const [conn] of conns) {
        if (conn !== origin) sendBinary(conn, out);
      }
    };
    awareness.on('update', awarenessUpdateHandler);

    const docUpdateHandler = (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const out = encoding.toUint8Array(encoder);

      for (const [conn] of conns) {
        if (conn !== origin) sendBinary(conn, out);
      }
    };
    doc.on('update', docUpdateHandler);

    ws.on('message', (rawData, isBinary) => {
      if (!isBinary) return;
      try {
        const data = new Uint8Array(rawData);
        const decoder = decoding.createDecoder(data);
        const msgType = decoding.readVarUint(decoder);

        switch (msgType) {
          case MSG_SYNC: {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MSG_SYNC);
            // Pass `ws` as the origin so the doc-update broadcaster skips the sender.
            syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
            if (encoding.length(encoder) > 1) {
              sendBinary(ws, encoding.toUint8Array(encoder));
            }
            return;
          }
          case MSG_AWARENESS: {
            const update = decoding.readVarUint8Array(decoder);
            // `ws` becomes the origin in the awareness 'update' event — that's how we
            // attribute the resulting client IDs to this connection for cleanup.
            awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
            return;
          }
        }
      } catch (err) {
        log.debug('doc', `malformed message on ${docName}: ${err.message}`);
      }
    });

    const cleanup = () => {
      doc.off('update', docUpdateHandler);
      awareness.off('update', awarenessUpdateHandler);
      docs.detach(docName, ws);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  };
}
