// WebSocket message-type constants shared between the room control channel
// and the per-doc Yjs sync channel.

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

// JSON control-channel message types
export const CONTROL = {
  CREATE: 'create',
  JOIN: 'join',
  APPROVE: 'approve',
  REJECT: 'reject',
  SHARE_FILE: 'share-file',
  UNSHARE_FILE: 'unshare-file',
  REORDER_FILES: 'reorder-files',
  CHAT_MESSAGE: 'chat-message',
  PRESENCE: 'presence',
  LEAVE: 'leave',
  KICK: 'kick',
  LOCK_ROOM: 'lock-room',
};

// Outbound JSON message types
export const OUT = {
  ROOM_CREATED: 'room-created',
  WAITING_APPROVAL: 'waiting-approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ROOM_CLOSED: 'room-closed',
  MEMBERS_UPDATE: 'members-update',
  JOIN_REQUEST: 'join-request',
  PEER_LEFT: 'peer-left',
  PROMOTED_TO_HOST: 'promoted-to-host',
  FILE_SHARED: 'file-shared',
  FILE_UNSHARED: 'file-unshared',
  FILES_REORDERED: 'files-reordered',
  CHAT_MESSAGE: 'chat-message',
  ERROR: 'error',
  KICKED: 'kicked',
  ROOM_LOCKED: 'room-locked',
};

// Predefined cursor colors (matches client)
export const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F1948A', '#82E0AA', '#F0B27A', '#AED6F1',
];

// Heartbeats / GC
export const HEARTBEAT_INTERVAL_MS = 25_000;
// How long an unattached doc lingers before GC. Overridable for tests.
// NOTE: docs whose file is still shared in a live room are NOT destroyed
// (gc guard) — the collaborative state must outlive viewer disconnects.
export const DOC_GC_DELAY_MS = Number(process.env.DOC_GC_DELAY_MS ?? 30_000);

// Input limits — applied per-message at the control channel boundary.
// Tuned so that a typical large source file (~ a few hundred KB) goes through
// but a misbehaving client cannot exhaust memory.
export const MAX_WS_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB per WS message
export const MAX_FILE_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MiB per shared file
export const MAX_FILE_ID_LEN = 200;
export const MAX_SHARED_FILES_PER_ROOM = 200;
export const MAX_REORDER_LIST_LEN = 200;
export const MAX_CHAT_LEN = 2000;

// Identity grammar enforced after percent-decoding at the upgrade boundary.
// A roomId containing '/' would corrupt the `roomId/fileId` doc-key namespace
// (cross-room collisions in DocRegistry and destroyByPrefix). Client file ids
// are crypto.randomUUID() / `${uuid}-${index}` — both inside FILE_ID_RE.
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const FILE_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

// Global resource caps — modest ceilings so a scripted client cannot grow
// server memory without bound. Normal usage never approaches these.
// Env-overridable for tests.
export const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 5_000);
export const MAX_MEMBERS_PER_ROOM = Number(process.env.MAX_MEMBERS_PER_ROOM ?? 64);
export const MAX_PENDING_PER_ROOM = Number(process.env.MAX_PENDING_PER_ROOM ?? 50);
// Durable rooms: snapshots of empty rooms are kept this long (hours) and a
// CREATE with the same id revives them. 0 disables revival/persistence.
export const ROOM_TTL_HOURS = Number(process.env.ROOM_TTL_HOURS ?? 24);
// How often live docs are snapshotted (crash resilience).
export const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 60_000);
// Max awareness clientIDs one connection may claim (a legit client has one).
export const MAX_AWARENESS_IDS_PER_CONN = 16;
// Per-socket send buffer before the peer is considered a stalled consumer.
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

// Chat rate limit: at most CHAT_BURST messages within CHAT_WINDOW_MS per peer.
export const CHAT_WINDOW_MS = 5_000;
export const CHAT_BURST = 10;

// WebSocket close codes used for intentional teardown. Mirrored client-side in
// frontend/src/services/collabService.ts — keep in sync.
export const CLOSE = {
  NORMAL: 1000,           // peaceful close (also: doc removed, client leave)
  GOING_AWAY: 1001,       // server shutdown / room closed
  POLICY_VIOLATION: 1008, // missing/invalid doc token, abuse
  FILE_UNSHARED: 4001,    // doc attach rejected: file not shared (unshare itself closes with 1000 'doc-removed')
};
