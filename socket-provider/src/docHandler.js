// Yjs doc channel handler — binary messages over /doc/:roomId/:fileId.
//
// Each connection just bridges its socket to the per-doc Y.Doc/Awareness owned
// by the DocRegistry. Broadcasting is the registry's responsibility — see
// `docs.js`. This file only handles initial handshake and inbound parsing.

import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MSG_SYNC, MSG_AWARENESS, CLOSE } from './constants.js';
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
      try { ws.close(CLOSE.FILE_UNSHARED, 'File not shared'); } catch {}
      return;
    }

    const entry = docs.attach(docName, ws);
    const { doc, awareness } = entry;

    {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      sendBinary(ws, encoding.toUint8Array(encoder));
    }

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
            // Pass `ws` as the transaction origin so the registry's update
            // listener can skip this socket when fanning the update out.
            syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
            if (encoding.length(encoder) > 1) {
              sendBinary(ws, encoding.toUint8Array(encoder));
            }
            return;
          }
          case MSG_AWARENESS: {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
            return;
          }
        }
      } catch (err) {
        log.debug('doc', `malformed message on ${docName}: ${err.message}`);
      }
    });

    const cleanup = () => docs.detach(docName, ws);
    ws.once('close', cleanup);
    ws.once('error', cleanup);
  };
}
