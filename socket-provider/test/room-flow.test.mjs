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

test('legacy lock-room maps onto the mode system and rejects joins', async () => {
  const host = await connect('/room/FLOW08');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'lock-room', locked: true });
  assert.ok(await findMsg(host, 'room-locked'), 'legacy broadcast still sent');
  const modeChanged = await findMsg(host, 'mode-changed');
  assert.ok(modeChanged && modeChanged.mode === 'locked', 'legacy message maps to locked mode');
  const guest = await connect('/room/FLOW08');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const err = await findMsg(guest, 'error');
  assert.ok(err && /locked/.test(err.message), 'join rejected while locked');
  host.close(); guest.close();
});

test('set-mode locked rejects joins and flushes pending requests', async () => {
  const host = await connect('/room/FLOW09');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');

  // A waiting guest gets flushed when the room locks.
  const waiting = await connect('/room/FLOW09');
  send(waiting, { type: 'join', displayName: 'W', color: '#4ECDC4' });
  assert.ok(await findMsg(host, 'join-request'), 'pending request arrives');
  send(host, { type: 'set-mode', mode: 'locked' });
  assert.ok(await findMsg(waiting, 'rejected'), 'pending guest flushed with REJECTED');
  assert.ok(await findMsg(host, 'mode-changed'), 'host sees mode change');

  const guest = await connect('/room/FLOW09');
  send(guest, { type: 'join', displayName: 'G', color: '#4ECDC4' });
  const err = await findMsg(guest, 'error');
  assert.ok(err && /locked/.test(err.message), 'fresh join rejected while locked');
  host.close(); guest.close(); waiting.close();
});

test('open mode joins instantly without approval', async () => {
  const host = await connect('/room/FLOW10');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'set-mode', mode: 'open' });
  assert.ok(await findMsg(host, 'mode-changed'), 'mode change broadcast');
  host.messages.length = 0; // drop the set-mode members-update

  const guest = await connect('/room/FLOW10');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const approved = await findMsg(guest, 'approved');
  assert.ok(approved, 'guest admitted without approval');
  assert.ok(approved.roomToken, 'guest receives a doc token');
  assert.ok(Array.isArray(approved.sharedFiles));
  const members = await findMsg(host, 'members-update');
  assert.ok(members.members.some((m) => m.displayName === 'Guest'), 'guest is a member');
  host.close(); guest.close();
});

test('switching to open admits everyone already waiting', async () => {
  const host = await connect('/room/FLOW11');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');

  const g1 = await connect('/room/FLOW11');
  send(g1, { type: 'join', displayName: 'G1', color: '#4ECDC4' });
  await findMsg(host, 'join-request');
  const g2 = await connect('/room/FLOW11');
  send(g2, { type: 'join', displayName: 'G2', color: '#45B7D1' });
  await findMsg(host, 'join-request');

  send(host, { type: 'set-mode', mode: 'open' });
  const a1 = await findMsg(g1, 'approved');
  const a2 = await findMsg(g2, 'approved');
  assert.ok(a1?.roomToken && a2?.roomToken, 'both waiting guests auto-admitted with tokens');
  host.close(); g1.close(); g2.close();
});

test('approval mode still requires host approval (default state)', async () => {
  const host = await connect('/room/FLOW12');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const guest = await connect('/room/FLOW12');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  assert.ok(await findMsg(guest, 'waiting-approval'), 'default mode requires approval');
  await findMsg(host, 'join-request');
  send(host, { type: 'set-mode', mode: 'locked' });
  await findMsg(host, 'mode-changed');
  send(host, { type: 'set-mode', mode: 'approval' });
  await findMsg(host, 'mode-changed');
  // Pending was flushed by the locked episode — the server closed the
  // guest's socket (like the real client flow), so it reconnects fresh.
  const guest2 = await connect('/room/FLOW12');
  send(guest2, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req2 = await findMsg(host, 'join-request');
  assert.ok(req2, 're-join request arrives after re-open');
  send(host, { type: 'approve', peerId: req2.peerId });
  assert.ok(await findMsg(guest2, 'approved'), 'approval flow works after mode changes');
  host.close(); guest2.close();
});
