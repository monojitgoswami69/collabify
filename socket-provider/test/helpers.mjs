// Test helpers — spawn a real socket-provider subprocess and probe it over WS.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

// Deterministic per-file port so parallel test files don't collide.
function portForFile() {
  if (process.env.TEST_PORT) return Number(process.env.TEST_PORT);
  const file = import.meta.url;
  let h = 0;
  for (const ch of file) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 4200 + (h % 500);
}

export const SERVER_PORT = portForFile();

export async function startServer(env = {}) {
  const port = env.PORT ? Number(env.PORT) : SERVER_PORT;
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  // Wait for the HTTP health endpoint to answer.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    proc,
    port,
    get output() { return out; },
    async stop() {
      proc.kill('SIGTERM');
      await once(proc, 'exit').catch(() => {});
    },
  };
}

export function connect(path, port = SERVER_PORT) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.messages = [];
    ws.on('message', (d, isBin) => ws.messages.push(isBin ? d : d.toString()));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('close', (code, reason) => { ws.closeCode = code; ws.closeReason = reason?.toString(); });
  });
}

export function send(ws, obj) { ws.send(JSON.stringify(obj)); }

export async function drain(ws, ms = 250) {
  await new Promise((r) => setTimeout(r, ms));
  return ws.messages.splice(0).map((s) => { try { return JSON.parse(s); } catch { return s; } });
}

export async function findMsg(ws, type, ms = 1500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const m of ws.messages) {
      try { const p = JSON.parse(m); if (p.type === type) { ws.messages.splice(ws.messages.indexOf(m), 1); return p; } } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
