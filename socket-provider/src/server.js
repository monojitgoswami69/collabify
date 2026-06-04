// Collabify Socket Provider — entrypoint.
//
// Architecture:
//   /room/:roomId            JSON control channel (Room class)
//   /doc/:roomId/:fileId     Binary Yjs sync + awareness (DocRegistry)
//
// Heartbeats keep proxies (Nginx, Cloudflare, etc.) from dropping idle sockets.
//
// TLS / WSS:
//   Set TLS_CERT and TLS_KEY env vars to absolute paths of the certificate and
//   private key files to enable HTTPS (and therefore WSS). When omitted the
//   server falls back to plain HTTP/WS — suitable for local development behind
//   a reverse proxy that terminates TLS.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

import { DocRegistry } from './docs.js';
import { createRoomHandler } from './roomHandler.js';
import { createDocHandler } from './docHandler.js';
import {
  HEARTBEAT_INTERVAL_MS,
  CLOSE,
  MAX_WS_PAYLOAD_BYTES,
} from './constants.js';
import { log } from './log.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── TLS configuration ──────────────────────────────────────────────────
const TLS_CERT = (process.env.TLS_CERT || '').trim();
const TLS_KEY = (process.env.TLS_KEY || '').trim();

let tlsOptions = null;
if (TLS_CERT && TLS_KEY) {
  try {
    tlsOptions = {
      cert: fs.readFileSync(TLS_CERT),
      key: fs.readFileSync(TLS_KEY),
    };
    log.info('tls', `TLS enabled — cert: ${TLS_CERT}`);
  } catch (err) {
    log.error('tls', `Failed to read TLS files: ${err.message}`);
    process.exit(1);
  }
}

// ── State ───────────────────────────────────────────────────────────────
/** @type {Map<string, import('./room.js').Room>} */
const rooms = new Map();
const docs = new DocRegistry();

// ── CORS helper ─────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Send a JSON response with CORS headers. */
function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── HTTP request handler ────────────────────────────────────────────────
function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    jsonResponse(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  switch (pathname) {
    case '/':
      jsonResponse(res, 200, { service: 'collabify-socket-provider', version: '1.0.0' });
      break;

    case '/health':
      jsonResponse(res, 200, {
        status: 'ok',
        rooms: rooms.size,
        docs: docs.count(),
        uptime: Math.floor(process.uptime()),
      });
      break;

    case '/stats': {
      const roomList = [];
      for (const [roomId, room] of rooms) {
        roomList.push({
          roomId,
          members: room.members.size,
          pending: room.pending.size,
          sharedFiles: room.sharedFiles.size,
        });
      }
      jsonResponse(res, 200, { rooms: roomList, totalDocs: docs.count() });
      break;
    }

    default:
      jsonResponse(res, 404, { error: 'Not Found' });
      break;
  }
}

// ── HTTP(S) server + WebSocket routing ──────────────────────────────────
const server = tlsOptions
  ? https.createServer(tlsOptions, handleRequest)
  : http.createServer(handleRequest);

const wss = new WebSocketServer({
  noServer: true,
  // Reject single frames bigger than this. ws default is 100 MiB; that's a
  // memory-exhaustion footgun. Tighten to a value large enough for big
  // source files but not for runaway clients.
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

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
const protocol = tlsOptions ? 'wss' : 'ws';

server.listen(PORT, HOST, () => {
  log.info('boot', `Collabify socket provider on ${HOST}:${PORT} (${tlsOptions ? 'TLS' : 'plain'})`);
  log.info('boot', `  control: ${protocol}://${HOST}:${PORT}/room/:roomId`);
  log.info('boot', `  doc:     ${protocol}://${HOST}:${PORT}/doc/:roomId/:fileId`);
});

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown(signal) {
  log.info('boot', `${signal} received, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(CLOSE.GOING_AWAY, 'server-shutdown'); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
