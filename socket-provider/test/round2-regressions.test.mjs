// Regression tests for the round-2 re-audit findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, send, drain, findMsg, SERVER_PORT } from './helpers.mjs';

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

async function makeHostRoom(room) {
  const host = await connect(`/room/${room}`);
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  assert.ok(created, 'room created');
  return { host, token: created.roomToken };
}

test('share-file rejects ids the doc channel grammar would refuse', async () => {
  const { host } = await makeHostRoom('R2A');
  send(host, { type: 'share-file', file: { id: 'a/b', name: 'x', language: '', content: 'x' } });
  const err = await findMsg(host, 'error');
  assert.ok(err && /invalid file id/i.test(err.message), 'slash id rejected with error');
  send(host, { type: 'share-file', file: { id: 'a b', name: 'x', language: '', content: 'x' } });
  const err2 = await findMsg(host, 'error');
  assert.ok(err2 && /invalid file id/i.test(err2.message), 'space id rejected with error');
  const shared = host.messages.some((m) => m.includes('file-shared'));
  assert.ok(!shared, 'nothing broadcast for invalid ids');
  host.close();
});

test('reject closes the rejected peer socket (no indefinite re-join spam)', async () => {
  const { host } = await makeHostRoom('R2B');
  const guest = await connect('/room/R2B');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'reject', peerId: req.peerId });
  assert.ok(await findMsg(guest, 'rejected'), 'rejected message received');
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(guest.closeCode !== undefined, 'socket closed after rejection');
  host.close();
});

test('reorder is ordering-only: omitted files are kept, docs untouched', async () => {
  const { host, token } = await makeHostRoom('R2C');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'one' } });
  send(host, { type: 'share-file', file: { id: 'f2', name: 'b', language: '', content: 'two' } });
  await findMsg(host, 'file-shared');
  const doc1 = await connect(`/doc/R2C/f1?token=${encodeURIComponent(token)}`);
  await new Promise((r) => setTimeout(r, 250));
  // A list omitting f1 (e.g. racing f1's share echo) must NOT destroy it —
  // removal is unshare-file's job.
  send(host, { type: 'reorder-files', files: [{ id: 'f2' }] });
  const reordered = await findMsg(host, 'files-reordered');
  assert.ok(reordered, 'files-reordered broadcast');
  assert.equal(reordered.sharedFiles.length, 2, 'omitted file kept in the room');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(doc1.closeCode, undefined, 'f1 doc socket NOT closed by reorder');
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  assert.equal(health.docs, 2, 'both docs still in the registry');
  host.close(); doc1.terminate();
});

test('LEAVE control message removes membership and revokes doc access', async () => {
  const { host } = await makeHostRoom('R2D');
  const guest = await connect('/room/R2D');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  const approved = await findMsg(guest, 'approved');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'x' } });
  await findMsg(host, 'file-shared');
  const doc = await connect(`/doc/R2D/f1?token=${encodeURIComponent(approved.roomToken)}`);
  await new Promise((r) => setTimeout(r, 250));
  send(guest, { type: 'leave' });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(doc.closeCode, 1008, 'leaving member doc socket revoked');
  const again = await connect(`/doc/R2D/f1?token=${encodeURIComponent(approved.roomToken)}`);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(again.closeCode, 1008, 'leaver token rejected on reconnect');
  host.close(); doc.terminate(); again.terminate();
});

test('host promotion transfers host privileges and doc access persists', async () => {
  const { host } = await makeHostRoom('R2E');
  const guest = await connect('/room/R2E');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  await findMsg(guest, 'approved');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'x' } });
  await findMsg(host, 'file-shared');
  host.close(); // sole host leaves -> guest promoted
  const promoted = await findMsg(guest, 'promoted-to-host');
  assert.ok(promoted, 'surviving member promoted to host');
  await new Promise((r) => setTimeout(r, 300));
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  assert.equal(health.rooms, 1, 'room survives host departure');
  assert.equal(health.docs, 1, 'docs survive host departure');
  guest.close();
});

test('unshare closes attached doc sockets (doc-removed)', async () => {
  const { host, token } = await makeHostRoom('R2F');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'x' } });
  await findMsg(host, 'file-shared');
  const doc = await connect(`/doc/R2F/f1?token=${encodeURIComponent(token)}`);
  await new Promise((r) => setTimeout(r, 250));
  send(host, { type: 'unshare-file', fileId: 'f1' });
  await new Promise((r) => setTimeout(r, 400));
  // Unshare tears the doc down via destroy(): close code 1000 'doc-removed'
  // (4001 is the attach-time "not shared" rejection; both are no-retry
  // codes on the client mirror).
  assert.equal(doc.closeCode, 1000, 'doc socket closed with doc-removed');
  host.close(); doc.terminate();
});
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';

/** Attach, request state (sync step 1), and return the merged doc text. */
async function readDocText(ws, ms = 600) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // MSG_SYNC
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

/** Hand-encode an awareness update (varuint count; per id: id, clock, JSON state). */
function encodeFakeAwareness(ids) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, ids.length);
  for (const id of ids) {
    encoding.writeVarUint(enc, id);
    encoding.writeVarUint(enc, 1); // clock
    encoding.writeVarString(enc, JSON.stringify({ user: { name: 'x', color: '#FF0000' } }));
  }
  return encoding.toUint8Array(enc);
}

test('post-GC re-attach preserves shared-file content (gc guard)', { timeout: 20_000 }, async () => {
  const srv = await startServer({ DOC_GC_DELAY_MS: '300', PORT: String(SERVER_PORT + 1) });
  const P = srv.port;
  const connect = (path) => import('./helpers.mjs').then((h) => h.connect(path, P));
  try {
    const host = await connect('/room/R3GC');
    send(host, { type: 'create', displayName: 'H', color: '#FF6B6B' });
    const created = await findMsg(host, 'room-created');
    send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: '', content: 'PRECIOUS-COLLAB-STATE' } });
    await findMsg(host, 'file-shared');

    const doc = await connect(`/doc/R3GC/f1?token=${encodeURIComponent(created.roomToken)}`);
    assert.equal(await readDocText(doc), 'PRECIOUS-COLLAB-STATE');
    doc.close(); // last connection detaches -> GC timer (300ms)
    await new Promise((r) => setTimeout(r, 900)); // GC fires — guard must keep the doc

    const again = await connect(`/doc/R3GC/f1?token=${encodeURIComponent(created.roomToken)}`);
    assert.equal(
      await readDocText(again),
      'PRECIOUS-COLLAB-STATE',
      'content survives GC while the file is still shared',
    );
    // But unshare DOES free the doc.
    send(host, { type: 'unshare-file', fileId: 'f1' });
    await new Promise((r) => setTimeout(r, 600));
    const health = await (await fetch(`http://127.0.0.1:${P}/health`)).json();
    assert.equal(health.docs, 0, 'unshare still frees the doc');
    host.close(); again.terminate();
  } finally {
    await srv.stop();
  }
});

test('awareness id flooding disconnects the abuser', { timeout: 15_000 }, async () => {
  const srv = await startServer({ DOC_GC_DELAY_MS: '300', PORT: String(SERVER_PORT + 2) });
  const P = srv.port;
  const connect = (path) => import('./helpers.mjs').then((h) => h.connect(path, P));
  try {
    const host = await connect('/room/R3AW');
    send(host, { type: 'create', displayName: 'H', color: '#FF6B6B' });
    const created = await findMsg(host, 'room-created');
    send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'x' } });
    await findMsg(host, 'file-shared');
    const doc = await connect(`/doc/R3AW/f1?token=${encodeURIComponent(created.roomToken)}`);
    await new Promise((r) => setTimeout(r, 200));
    // Spoof 24 distinct awareness clientIDs from one connection.
    const fakeIds = Array.from({ length: 24 }, (_, i) => 900000 + i);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1); // MSG_AWARENESS
    encoding.writeVarUint8Array(enc, encodeFakeAwareness(fakeIds));
    doc.send(encoding.toUint8Array(enc));
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(doc.closeCode, 1008, 'flooder disconnected with policy violation');
    host.close(); doc.terminate();
  } finally {
    await srv.stop();
  }
});
