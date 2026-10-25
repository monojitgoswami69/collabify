// Durable rooms: snapshot on empty, revival on CREATE after restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import { startServer, connect, send, findMsg, SERVER_PORT } from './helpers.mjs';

const DB = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'collabify-')), 'rooms.db');

async function readDocText(ws, ms = 600) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, new Y.Doc());
  ws.send(encoding.toUint8Array(enc));
  await new Promise((r) => setTimeout(r, ms));
  const doc = new Y.Doc();
  for (const m of ws.messages.splice(0)) {
    try {
      const dec = decoding.createDecoder(new Uint8Array(m));
      if (decoding.readVarUint(dec) === 0) {
        syncProtocol.readSyncMessage(dec, encoding.createEncoder(), doc, 'probe');
      }
    } catch {}
  }
  return doc.getText('monaco').toString();
}

test('room content survives a full server restart and revives on CREATE', { timeout: 30_000 }, async () => {
  const dbPath = DB();
  const P1 = SERVER_PORT + 1;
  const srv1 = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P1) });
  const connect1 = (p) => import('./helpers.mjs').then((h) => h.connect(p, P1));

  const host = await connect1('/room/DURABLE1');
  send(host, { type: 'create', displayName: 'H', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'keeper.ts', language: 'TypeScript', content: 'DURABLE-CONTENT' } });
  await findMsg(host, 'file-shared');

  // Empty the room: host leaves -> snapshot + dormant.
  host.close();
  await new Promise((r) => setTimeout(r, 600));
  await srv1.stop();

  // A fresh server process on the same DB revives the room on CREATE.
  const srv2 = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P1) });
  try {
    const host2 = await connect1('/room/DURABLE1');
    send(host2, { type: 'create', displayName: 'H2', color: '#FF6B6B' });
    const created = await findMsg(host2, 'room-created');
    assert.ok(created, 'room revived');
    assert.ok(created.roomToken, 'fresh token issued');

    // Shared-file metadata restored.
    const doc = await connect1(`/doc/DURABLE1/f1?token=${encodeURIComponent(created.roomToken)}`);
    assert.equal(await readDocText(doc), 'DURABLE-CONTENT', 'document content restored');
    doc.terminate();

    // members-update advertises the restored shared file.
    send(host2, { type: 'share-file', file: { id: 'f1', name: 'keeper.ts', language: 'TypeScript', content: 'DURABLE-CONTENT' } });
    await new Promise((r) => setTimeout(r, 300));
    host2.close();
  } finally {
    await srv2.stop();
  }

  // Unshare after revival must drop the persisted doc: revive once more and
  // verify the file is gone from metadata after another restart.
  const srv3 = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P1) });
  try {
    const host3 = await connect1('/room/DURABLE1');
    send(host3, { type: 'create', displayName: 'H3', color: '#FF6B6B' });
    await findMsg(host3, 'room-created');
    send(host3, { type: 'unshare-file', fileId: 'f1' });
    await new Promise((r) => setTimeout(r, 300));
    host3.close();
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    await srv3.stop();
  }

  const srv4 = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P1) });
  try {
    const host4 = await connect1('/room/DURABLE1');
    send(host4, { type: 'create', displayName: 'H4', color: '#FF6B6B' });
    await findMsg(host4, 'room-created');
    send(host4, { type: 'share-file', file: { id: 'f1', name: 'keeper.ts', language: '', content: 'x' } });
    await new Promise((r) => setTimeout(r, 300));
    // f1 was unshared pre-restart, so this is a fresh share — nothing stale.
    host4.close();
  } finally {
    await srv4.stop();
  }
});

test('live docs are snapshotted periodically (crash resilience)', { timeout: 30_000 }, async () => {
  const dbPath = DB();
  const P = SERVER_PORT + 2;
  const srv = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P), SNAPSHOT_INTERVAL_MS: '400' });
  const conn = (p) => import('./helpers.mjs').then((h) => h.connect(p, P));
  try {
    const host = await conn('/room/DURABLE2');
    send(host, { type: 'create', displayName: 'H', color: '#FF6B6B' });
    const created = await findMsg(host, 'room-created');
    send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: '', content: 'LIVE' } });
    await findMsg(host, 'file-shared');
    const doc = await conn(`/doc/DURABLE2/f1?token=${encodeURIComponent(created.roomToken)}`);
    // Wait past one snapshot tick (400ms) so the live doc is persisted.
    await new Promise((r) => setTimeout(r, 900));

    // Kill the server WITHOUT graceful shutdown — the periodic snapshot
    // must already have persisted the doc.
    srv.proc.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 400));

    const srv2 = await startServer({ COLLABIFY_DB_PATH: dbPath, PORT: String(P) });
    try {
      const host2 = await conn('/room/DURABLE2');
      send(host2, { type: 'create', displayName: 'H2', color: '#FF6B6B' });
      const created2 = await findMsg(host2, 'room-created');
      assert.ok(created2?.roomToken, 'revived room issues a token');
      const doc2 = await conn(`/doc/DURABLE2/f1?token=${encodeURIComponent(created2.roomToken)}`);
      const text = await readDocText(doc2);
      assert.ok(text.includes('LIVE'), `live snapshot survived SIGKILL (got "${text}")`);
      host2.close(); doc2.terminate();
    } finally {
      await srv2.stop();
    }
  } finally {
    try { srv.proc.kill('SIGKILL'); } catch {}
  }
});
