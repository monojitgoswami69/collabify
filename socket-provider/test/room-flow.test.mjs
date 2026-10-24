// Room control-channel integration tests: create/join/approve/kick/lock/chat flows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, send, drain, findMsg } from './helpers.mjs';

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

test('host creates room and receives room-created with token', async () => {
  const host = await connect('/room/FLOW01');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  assert.ok(created, 'room-created received');
  assert.equal(created.roomId, 'FLOW01');
  assert.equal(typeof created.peerId, 'string');
  assert.equal(typeof created.roomToken, 'string', 'room token delivered to host');
  host.close();
});

test('guest join -> host approve -> both members', async () => {
  const host = await connect('/room/FLOW02');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');

  const guest = await connect('/room/FLOW02');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const waiting = await findMsg(guest, 'waiting-approval');
  assert.ok(waiting, 'guest waits for approval');
  assert.equal(typeof waiting.peerId, 'string');

  const req = await findMsg(host, 'join-request');
  assert.ok(req, 'host sees join request');
  // Drop the join-time members-update so the next one reflects the approval.
  host.messages.length = 0;
  send(host, { type: 'approve', peerId: req.peerId });

  const approved = await findMsg(guest, 'approved');
  assert.ok(approved, 'guest approved');
  assert.equal(typeof approved.roomToken, 'string', 'approved guest receives room token');
  assert.ok(Array.isArray(approved.sharedFiles));

  const members = await findMsg(host, 'members-update');
  assert.equal(members.members.length, 2);
  host.close(); guest.close();
});

test('guest retrying join after room creation succeeds on same socket', async () => {
  const guest = await connect('/room/FLOW03');
  send(guest, { type: 'join', displayName: 'Early', color: '#4ECDC4' });
  const err1 = await findMsg(guest, 'error');
  assert.ok(err1 && /does not exist/.test(err1.message), 'first join fails while room absent');

  const host = await connect('/room/FLOW03');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');

  // Same guest socket, retry — must NOT get a stale-closure error.
  send(guest, { type: 'join', displayName: 'Early', color: '#4ECDC4' });
  const waiting = await findMsg(guest, 'waiting-approval');
  assert.ok(waiting, 'retry join after create reaches pending state');
  host.close(); guest.close();
});

test('create after room destruction succeeds (pending socket is closed, fresh socket re-creates)', async () => {
  const h = await connect('/room/FLOW04');
  send(h, { type: 'create', displayName: 'H', color: '#FF6B6B' });
  await findMsg(h, 'room-created');
  const g = await connect('/room/FLOW04');
  send(g, { type: 'join', displayName: 'G', color: '#4ECDC4' });
  await findMsg(g, 'waiting-approval');
  h.close(); // host leaves; room destroyed; pending guest told room-closed
  const closed = await findMsg(g, 'room-closed');
  assert.ok(closed, 'pending guest notified of close');
  // The server closes the pending socket after room-closed — creating the
  // room again requires a fresh connection (the client does the same).
  const g2 = await connect('/room/FLOW04');
  send(g2, { type: 'create', displayName: 'NewHost', color: '#FF6B6B' });
  const created = await findMsg(g2, 'room-created');
  assert.ok(created, 'create succeeds after the old room was destroyed');
  g2.close();
});

test('host can kick a member; kicked peer is notified', async () => {
  const host = await connect('/room/FLOW05');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const guest = await connect('/room/FLOW05');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  await findMsg(guest, 'approved');
  send(host, { type: 'kick', peerId: req.peerId });
  const kicked = await findMsg(guest, 'kicked');
  assert.ok(kicked, 'kicked peer notified');
  host.close();
});

test('chat messages broadcast to members with server identity', async () => {
  const host = await connect('/room/FLOW06');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'chat-message', text: 'hello world' });
  const chat = await findMsg(host, 'chat-message');
  assert.ok(chat, 'chat echoed back (client relies on server echo)');
  assert.equal(chat.text, 'hello world');
  assert.equal(chat.displayName, 'Host');
  assert.equal(typeof chat.id, 'string');
  assert.equal(typeof chat.timestamp, 'number');
  host.close();
});

test('non-host cannot approve, share, kick, or lock', async () => {
  const host = await connect('/room/FLOW07');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const guest = await connect('/room/FLOW07');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  await findMsg(guest, 'approved');

  send(guest, { type: 'approve', peerId: 'peer_x' });
  send(guest, { type: 'share-file', file: { id: 'x', name: 'x', language: '', content: '' } });
  send(guest, { type: 'kick', peerId: 'peer_x' });
  send(guest, { type: 'lock-room', locked: true });
  await drain(guest, 300);
  const bad = guest.messages.map((m) => { try { return JSON.parse(m); } catch { return null; } })
    .filter((m) => m && (m.type === 'file-shared' || m.type === 'room-locked'));
  assert.equal(bad.length, 0, 'no privileged effects from non-host');
  host.close(); guest.close();
});

test('locking a room rejects new joins and pending requests', async () => {
  const host = await connect('/room/FLOW08');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'lock-room', locked: true });
  await findMsg(host, 'room-locked');
  const guest = await connect('/room/FLOW08');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const err = await findMsg(guest, 'error');
  assert.ok(err && /locked/.test(err.message), 'join rejected while locked');
  host.close(); guest.close();
});
