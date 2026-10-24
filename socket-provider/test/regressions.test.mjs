// Regression tests for the crash/DoS/authz bugs found in the Phase 1 audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, send, drain, findMsg } from './helpers.mjs';
import WebSocket from 'ws';
import { SERVER_PORT } from './helpers.mjs';

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

async function alive() {
  try { const r = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`); return r.ok; }
  catch { return false; }
}

test('reorder-files with null elements does not crash the server', async () => {
  const host = await connect('/room/REG001');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  send(host, { type: 'reorder-files', files: [null, undefined, 5, 'x', {}, { id: 'a' }] });
  await drain(host, 400);
  assert.ok(await alive(), 'server survives malformed reorder payload');
  // Server must still work afterwards
  const other = await connect('/room/REG002');
  send(other, { type: 'create', displayName: 'H', color: '#FF6B6B' });
  assert.ok(await findMsg(other, 'room-created'), 'server still handles new rooms');
  host.close(); other.close();
});

test('malformed percent-encoding in path does not crash the server', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${SERVER_PORT}/room/%E0%A4%A`);
  await new Promise((r) => { ws.on('error', r); ws.on('close', r); setTimeout(r, 800); });
  try { ws.terminate(); } catch {}
  assert.ok(await alive(), 'server survives malformed URI encoding');
});

test('room ids containing slashes are rejected', async () => {
  await assert.rejects(
    () => connect('/room/AB%2FCD'),
    (err) => true,
  );
  assert.ok(await alive(), 'server fine after slash-room attempt');
});

test('oversized payloads are rejected without crashing', async () => {
  const host = await connect('/room/REG003');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const big = 'x'.repeat(3 * 1024 * 1024); // > 2 MiB maxPayload
  await new Promise((r) => { host.send(JSON.stringify({ type: 'chat-message', text: big }), r); });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(await alive(), 'server survives oversized frame');
  host.close();
});

test('doc channel requires a valid room token', async () => {
  const host = await connect('/room/REG004');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: 'TypeScript', content: 'hello' } });
  assert.ok(await findMsg(host, 'file-shared'), 'file shared');

  // No token -> rejected
  const noTok = await connect('/doc/REG004/f1');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(noTok.closeCode, 1008, 'no token -> policy violation close');
  noTok.terminate();

  // Wrong token -> rejected
  const badTok = await connect('/doc/REG004/f1?token=WRONG');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(badTok.closeCode, 1008, 'wrong token -> policy violation close');
  badTok.terminate();

  // Correct token -> accepted and sync begins
  const good = await connect(`/doc/REG004/f1?token=${encodeURIComponent(created.roomToken)}`);
  await new Promise((r) => setTimeout(r, 400));
  assert.notEqual(good.closeCode, 1008, 'correct token accepted');
  const bin = good.messages.filter((m) => typeof m !== 'string');
  assert.ok(bin.length > 0, 'server sends Yjs sync handshake to authorized doc conn');
  good.terminate();
  host.close();
});

test('unapproved guest cannot reach the doc channel even knowing ids', async () => {
  const host = await connect('/room/REG005');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: '', content: 'secret' } });
  await findMsg(host, 'file-shared');

  const guest = await connect('/room/REG005');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  await findMsg(guest, 'waiting-approval');
  // Guest knows roomId + fileId but has no token; even the host's token must not be guessable
  const docNoTok = await connect('/doc/REG005/f1');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(docNoTok.closeCode, 1008, 'waiting guest cannot attach without token');
  docNoTok.terminate();
  assert.notEqual(created.roomToken, undefined);
  host.close(); guest.close();
});

test('/stats does not enumerate room ids', async () => {
  const host = await connect('/room/REG006');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/stats`);
  const body = await res.json();
  const s = JSON.stringify(body);
  assert.ok(!s.includes('REG006'), 'no room id leak in /stats');
  assert.equal(body.rooms, 1, 'aggregate room count present');
  host.close();
});

test('duplicate join from an already-approved member is ignored', async () => {
  const host = await connect('/room/REG007');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  await findMsg(host, 'room-created');
  const guest = await connect('/room/REG007');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  await findMsg(guest, 'approved');

  send(guest, { type: 'join', displayName: 'Guest2', color: '#4ECDC4' });
  await drain(guest, 300);
  const members = await findMsg(host, 'members-update');
  assert.ok(!members.members.some((m) => m.displayName === 'Guest2'), 'no duplicate member entry');
  assert.ok(!members.pending.some((m) => m.displayName === 'Guest2'), 'member not demoted to pending');
  host.close(); guest.close();
});

test('malformed Host header does not crash the server (HTTP and upgrade paths)', async () => {
  const net = await import('node:net');
  const probe = (payload) => new Promise((resolve) => {
    const sock = net.connect(SERVER_PORT, '127.0.0.1', () => sock.write(payload));
    sock.on('error', () => resolve());
    sock.on('close', () => resolve());
    setTimeout(() => { sock.destroy(); resolve(); }, 500);
  });
  await probe('GET /health HTTP/1.1\r\nHost: a]]]]b\r\nConnection: close\r\n\r\n');
  assert.ok(await alive(), 'server survives malformed Host on HTTP path');
  await probe('GET /room/X HTTP/1.1\r\nHost: a]]]]b\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  assert.ok(await alive(), 'server survives malformed Host on upgrade path');
});

test('pre-connected socket cannot take over an existing room (CREATE TOCTOU)', async () => {
  // Attacker connects BEFORE the victim creates the room.
  const attacker = await connect('/room/REG008');
  const victim = await connect('/room/REG008');
  send(victim, { type: 'create', displayName: 'Victim', color: '#FF6B6B' });
  assert.ok(await findMsg(victim, 'room-created'), 'victim creates the room');

  // Attacker's late CREATE must be rejected — not overwrite the map entry.
  send(attacker, { type: 'create', displayName: 'Attacker', color: '#4ECDC4' });
  const err = await findMsg(attacker, 'error');
  assert.ok(err && /already exists/.test(err.message), 'late create rejected');

  // And joins must still land in the victim's room.
  const joiner = await connect('/room/REG008');
  send(joiner, { type: 'join', displayName: 'J', color: '#4ECDC4' });
  const req = await findMsg(victim, 'join-request');
  assert.ok(req, 'join request reaches the legitimate host');
  const steal = await drain(attacker, 200);
  assert.ok(!steal.some((m) => m.type === 'join-request'), 'attacker gets no join request');
  attacker.close(); victim.close(); joiner.close();
});

test('kicked member loses doc access immediately (doc sockets closed)', async () => {
  const host = await connect('/room/REG009');
  send(host, { type: 'create', displayName: 'Host', color: '#FF6B6B' });
  const created = await findMsg(host, 'room-created');
  send(host, { type: 'share-file', file: { id: 'f1', name: 'a.ts', language: '', content: 'x' } });
  await findMsg(host, 'file-shared');

  const guest = await connect('/room/REG009');
  send(guest, { type: 'join', displayName: 'Guest', color: '#4ECDC4' });
  const req = await findMsg(host, 'join-request');
  send(host, { type: 'approve', peerId: req.peerId });
  const approved = await findMsg(guest, 'approved');
  assert.ok(approved?.roomToken, 'guest has doc token');

  const doc = await connect(`/doc/REG009/f1?token=${encodeURIComponent(approved.roomToken)}`);
  await new Promise((r) => setTimeout(r, 300));
  send(host, { type: 'kick', peerId: req.peerId });
  await findMsg(guest, 'kicked');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(doc.closeCode, 1008, 'kicked member doc socket closed with policy violation');

  // The revoked token no longer grants NEW doc connections either.
  const again = await connect(`/doc/REG009/f1?token=${encodeURIComponent(approved.roomToken)}`);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(again.closeCode, 1008, 'revoked token rejected on reconnect');
  host.close(); doc.terminate(); again.terminate();
});
