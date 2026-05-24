// Codalyzer Socket Provider — entrypoint.
//
// Architecture:
//   /room/:roomId            JSON control channel (Room class)
//   /doc/:roomId/:fileId     Binary Yjs sync + awareness (DocRegistry)
//
// Heartbeats keep proxies (Nginx, Cloudflare, etc.) from dropping idle sockets.

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

import { DocRegistry } from './docs.js';
import { createRoomHandler } from './roomHandler.js';
import { createDocHandler } from './docHandler.js';
import { HEARTBEAT_INTERVAL_MS } from './constants.js';
import { log } from './log.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── State ───────────────────────────────────────────────────────────────
/** @type {Map<string, import('./room.js').Room>} */
const rooms = new Map();
const docs = new DocRegistry();

// ── HTTP (Express) ──────────────────────────────────────────────────────
const app = express();
app.use(cors());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    docs: docs.count(),
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/stats', (_req, res) => {
  const roomList = [];
  for (const [roomId, room] of rooms) {
    roomList.push({
      roomId,
      members: room.members.size,
      pending: room.pending.size,
      sharedFiles: room.sharedFiles.size,
    });
  }
  res.json({ rooms: roomList, totalDocs: docs.count() });
});

app.get('/', (_req, res) => {
  res.json({ service: 'codalyzer-socket-provider', version: '1.0.0' });
});

// ── HTTP server + WebSocket routing ─────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const handleRoom = createRoomHandler({ rooms, docs });
const handleDoc = createDocHandler({ rooms, docs });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);
  if (roomMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      const roomId = decodeURIComponent(roomMatch[1]);
      handleRoom(ws, roomId);
    });
    return;
  }

  const docMatch = pathname.match(/^\/doc\/([^/]+)\/([^/]+)$/);
  if (docMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      const roomId = decodeURIComponent(docMatch[1]);
      const fileId = decodeURIComponent(docMatch[2]);
      handleDoc(ws, roomId, fileId);
    });
    return;
  }

  socket.destroy();
});

// ── Heartbeat ───────────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on('close', () => clearInterval(heartbeat));

// ── Listen ──────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  log.info('boot', `Codalyzer socket provider on ${HOST}:${PORT}`);
  log.info('boot', `  control: ws://${HOST}:${PORT}/room/:roomId`);
  log.info('boot', `  doc:     ws://${HOST}:${PORT}/doc/:roomId/:fileId`);
});

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown(signal) {
  log.info('boot', `${signal} received, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server-shutdown'); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
