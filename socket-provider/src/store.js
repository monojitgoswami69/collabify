// Durable-room store — SQLite via Node's built-in node:sqlite.
//
// When a room's last member leaves, its documents and metadata are
// snapshotted here and the in-memory state is freed. A CREATE with the same
// room id revives it (docs restored, sharer becomes host) until the TTL
// purge reclaims it. The room id remains the capability: 40 bits of CSPRNG.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id     TEXT PRIMARY KEY,
      meta        TEXT NOT NULL,
      last_active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      room_id    TEXT NOT NULL,
      file_id    TEXT NOT NULL,
      state      BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_docs_room ON docs(room_id);
  `);

  return {
    saveRoom(roomId, meta, now) {
      db.prepare(
        `INSERT INTO rooms (room_id, meta, last_active) VALUES (?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET meta = excluded.meta, last_active = excluded.last_active`,
      ).run(roomId, JSON.stringify(meta), now);
    },

    getRoom(roomId) {
      return db.prepare('SELECT room_id, meta, last_active FROM rooms WHERE room_id = ?').get(roomId) || null;
    },

    deleteRoom(roomId) {
      db.prepare('DELETE FROM docs WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
    },

    saveDoc(roomId, fileId, state, now) {
      db.prepare(
        `INSERT INTO docs (room_id, file_id, state, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id, file_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      ).run(roomId, fileId, state, now);
    },

    deleteDoc(roomId, fileId) {
      db.prepare('DELETE FROM docs WHERE room_id = ? AND file_id = ?').run(roomId, fileId);
    },

    listDocs(roomId) {
      return db.prepare('SELECT file_id, state FROM docs WHERE room_id = ?').all(roomId);
    },

    /** Delete rooms (and their docs) idle beyond the TTL. Returns rows removed. */
    purge(ttlMs, now = Date.now()) {
      const stale = db.prepare('SELECT room_id FROM rooms WHERE last_active < ?').all(now - ttlMs);
      for (const { room_id } of stale) this.deleteRoom(room_id);
      return stale.length;
    },

    close() {
      db.close();
    },
  };
}
