// Doc registry lifecycle: share/unshare/GC/room-destroy cleanup + memory bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, send, findMsg, SERVER_PORT } from './helpers.mjs';

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

test('unsharing a file kicks doc connections and drops the doc', async () => {
  const host = await connect('/room/DOC001');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: '', content: 'x' } });
  await findMsg(host, 'file-shared');

  const doc = await connect(`/doc/DOC001/f1?token=${encodeURIComponent(created.roomToken)}`);
  await new Promise((r) => setTimeout(r, 300));
  send(host, { type: 'unshare-file', fileId: 'f1' });
  await findMsg(host, 'file-unshared');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(doc.closeCode, 1000, 'doc connection closed with NORMAL after unshare');
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  assert.equal(health.docs, 0, 'doc removed from registry on unshare');
  host.close(); doc.terminate();
});

test('room destruction destroys all its docs', async () => {
  const host = await connect('/room/DOC002');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a', language: '', content: '1' } });
  send(host, { type: 'share-file', file: { id: 'f2', name: 'b', language: '', content: '2' } });
  await findMsg(host, 'file-shared');
  host.close(); // last member leaves -> room + docs destroyed
  await new Promise((r) => setTimeout(r, 500));
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  assert.equal(health.rooms, 0, 'room destroyed');
  assert.equal(health.docs, 0, 'docs destroyed with the room');
});

test('oversized file share is rejected with an error', async () => {
  const host = await connect('/room/DOC003');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const huge = 'y'.repeat(1024 * 1024 + 10); // > 1 MiB
  send(host, { type: 'share-file', file: { id: 'f1', name: 'big', language: '', content: huge } });
  const err = await findMsg(host, 'error');
  assert.ok(err && /too large/i.test(err.message), 'size cap enforced');
  const shared = host.messages.some((m) => m.includes('file-shared'));
  assert.ok(!shared, 'oversized file not shared');
  host.close();
});

test('chat rate limit silently drops bursts beyond the cap', async () => {
  const host = await connect('/room/DOC004');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  for (let i = 0; i < 15; i++) send(host, { type: 'chat-message', text: `msg ${i}` });
  await new Promise((r) => setTimeout(r, 600));
  const chats = host.messages.filter((m) => m.includes('"chat-message"')).length;
  assert.ok(chats <= 11, `burst capped (got ${chats})`);
  host.close();
});
