// Collabify Socket Provider — entrypoint.
//
// Architecture:
//   /room/:roomId                      JSON control channel (Room class)
//   /doc/:roomId/:fileId?token=…       Binary Yjs sync + awareness (DocRegistry)
//
// The `token` query parameter on the doc channel is a per-member capability
// issued by the control channel (in `room-created` / `approved`); without it a
// connection is rejected, so document access follows room membership.
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

import path from 'node:path';
import { DocRegistry } from './docs.js';
import { createStore } from './store.js';
import { createRoomHandler } from './roomHandler.js';
import { createDocHandler } from './docHandler.js';
import {
  HEARTBEAT_INTERVAL_MS,
  CLOSE,
  MAX_WS_PAYLOAD_BYTES,
  ROOM_ID_RE,
  FILE_ID_RE,
  ROOM_TTL_HOURS,
  SNAPSHOT_INTERVAL_MS,
} from './constants.js';
import { log } from './log.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  log.error('boot', `Invalid PORT "${process.env.PORT}" — must be an integer between 0 and 65535`);
  process.exit(1);
}

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

// ── URL / path-segment helpers ──────────────────────────────────────────

/**
 * Parse req.url defensively. A malformed or missing Host header (or request
 * target) must yield a rejection, never a thrown TypeError — the HTTP and
 * upgrade paths both run inside event callbacks where a throw would be fatal.
 * @returns {URL | null}
 */
function safeParseUrl(req) {
  try {
    return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    return null;
  }
}

/**
 * Decode a percent-encoded path segment and validate it against the room/file
 * id grammar. Returns null for malformed encodings (decodeURIComponent throws)
 * or disallowed characters — a `/` inside a roomId would corrupt the
 * `roomId/fileId` doc keys and let one room's teardown destroy another's docs.
 * @returns {string | null}
 */
function decodeSegment(segment, allowed) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return allowed.test(decoded) ? decoded : null;
}

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
  const url = safeParseUrl(req);
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Bad Request' }));
    return;
  }
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

    case '/stats':
      // Aggregates only — never enumerate room ids; the room id is the only
      // join secret, and doc access used to be guessable from it.
      jsonResponse(res, 200, {
        rooms: rooms.size,
        totalDocs: docs.count(),
        totalMembers: Array.from(rooms.values()).reduce((n, r) => n + r.members.size, 0),
        totalPending: Array.from(rooms.values()).reduce((n, r) => n + r.pending.size, 0),
      });
      break;

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

// ── Durable rooms ───────────────────────────────────────────────────────
// Empty rooms are snapshotted to SQLite and revived on CREATE until the TTL
// purge. ROOM_TTL_HOURS=0 disables persistence entirely.
const store =
  ROOM_TTL_HOURS > 0
    ? createStore(process.env.COLLABIFY_DB_PATH || path.join(process.cwd(), 'data', 'collabify.db'))
    : null;

const handleRoom = createRoomHandler({ rooms, docs, store });
const handleDoc = createDocHandler({ rooms, docs });

// A doc whose file is still shared in a live room must survive GC — the
// Y.Doc holds the only copy of the collaborative state. Room ids cannot
// contain '/', so the first '/' cleanly splits roomId from fileId.
docs.setGcGuard((docName) => {
  const slash = docName.indexOf('/');
  if (slash === -1) return false;
  const room = rooms.get(docName.slice(0, slash));
  return room ? room.hasSharedFile(docName.slice(slash + 1)) : false;
});

server.on('upgrade', (req, socket, head) => {
  const url = safeParseUrl(req);
  if (!url) {
    socket.destroy();
    return;
  }
  const pathname = url.pathname;

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);
  if (roomMatch) {
    const roomId = decodeSegment(roomMatch[1], ROOM_ID_RE);
    if (!roomId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      handleRoom(ws, roomId);
    });
    return;
  }

  const docMatch = pathname.match(/^\/doc\/([^/]+)\/([^/]+)$/);
  if (docMatch) {
    const roomId = decodeSegment(docMatch[1], ROOM_ID_RE);
    const fileId = decodeSegment(docMatch[2], FILE_ID_RE);
    if (!roomId || !fileId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      handleDoc(ws, roomId, fileId, url.searchParams.get('token') || '');
    });
    return;
  }

  socket.destroy();
});

// ── Live-doc snapshots (crash resilience) ───────────────────────────────
let snapshotTimer = null;
if (store) {
  snapshotTimer = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      if (room.members.size === 0) continue;
      // Metadata + docs together, so a crash revives rooms wholesale.
      store.saveRoom(roomId, { sharedFiles: room.getSharedFilesList(), mode: room.mode }, now);
      for (const fileId of room.sharedFiles.keys()) {
        const state = docs.snapshot(`${roomId}/${fileId}`);
        if (state) store.saveDoc(roomId, fileId, state, now);
      }
    }
  }, SNAPSHOT_INTERVAL_MS);
  // TTL purge for dormant rooms.
  setInterval(() => {
    const removed = store.purge(ROOM_TTL_HOURS * 3_600_000);
    if (removed > 0) log.info('store', `purged ${removed} dormant room(s)`);
  }, 60 * 60_000).unref();
}

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

server.on('error', (err) => {
  log.error('boot', `Server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log.info('boot', `Collabify socket provider on ${HOST}:${PORT} (${tlsOptions ? 'TLS' : 'plain'})`);
  log.info('boot', `  control: ${protocol}://${HOST}:${PORT}/room/:roomId`);
  log.info('boot', `  doc:     ${protocol}://${HOST}:${PORT}/doc/:roomId/:fileId?token=:memberToken`);
});

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown(signal) {
  log.info('boot', `${signal} received, shutting down`);
  clearInterval(heartbeat);
  if (snapshotTimer) clearInterval(snapshotTimer);
  // Persist every live doc so a restart revives rooms with full content.
  if (store) {
    try {
      const now = Date.now();
      for (const [docName, state] of docs.snapshotAll()) {
        const slash = docName.indexOf('/');
        if (slash === -1) continue;
        store.saveDoc(docName.slice(0, slash), docName.slice(slash + 1), state, now);
      }
      store.close();
    } catch (err) {
      log.error('boot', `shutdown snapshot failed: ${err.message}`);
    }
  }
  for (const ws of wss.clients) {
    try { ws.close(CLOSE.GOING_AWAY, 'server-shutdown'); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
