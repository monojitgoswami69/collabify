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

test('reorder dropping a file closes its doc connections and frees the doc', async () => {
  const { host, token } = await makeHostRoom('R2C');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: 'one' } });
  send(host, { type: 'share-file', file: { id: 'f2', name: 'b', language: '', content: 'two' } });
  await findMsg(host, 'file-shared');
  const doc1 = await connect(`/doc/R2C/f1?token=${encodeURIComponent(token)}`);
  await new Promise((r) => setTimeout(r, 250));
  send(host, { type: 'reorder-files', files: [{ id: 'f2' }] }); // f1 dropped
  assert.ok(await findMsg(doc1, undefined, 300) || true); // drain silently
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(doc1.closeCode, 1000, 'dropped file doc socket closed with NORMAL');
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  assert.equal(health.docs, 1, 'dropped doc removed from registry');
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
