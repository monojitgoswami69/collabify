// Utility helpers shared by the room and doc channels.

import { WebSocket } from 'ws';

let counter = 0;
export function generateId(prefix = 'id') {
  counter = (counter + 1) % 0xffffffff;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function sendJson(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Ignore: socket may have closed between the readyState check and send.
    }
  }
}

export function sendBinary(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(data, { binary: true });
    } catch {
      // Ignore
    }
  }
}

export function safeJsonParse(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

export function sanitizeStr(value, fallback, maxLen = 80) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

export function sanitizeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}
