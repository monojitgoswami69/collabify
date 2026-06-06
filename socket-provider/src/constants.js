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
  LEAVE: 'leave',
  PING: 'ping',
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
  PONG: 'pong',
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
export const DOC_GC_DELAY_MS = 30_000;

// Input limits — applied per-message at the control channel boundary.
// Tuned so that a typical large source file (~ a few hundred KB) goes through
// but a misbehaving client cannot exhaust memory.
export const MAX_WS_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB per WS message
export const MAX_FILE_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MiB per shared file
export const MAX_FILE_ID_LEN = 200;
export const MAX_SHARED_FILES_PER_ROOM = 200;
export const MAX_REORDER_LIST_LEN = 200;
export const MAX_CHAT_LEN = 2000;

// Chat rate limit: at most CHAT_BURST messages within CHAT_WINDOW_MS per peer.
export const CHAT_WINDOW_MS = 5_000;
export const CHAT_BURST = 10;

// WebSocket close codes used for intentional teardown. Mirrored client-side in
// code-collab/src/services/collabService.ts — keep in sync.
export const CLOSE = {
  NORMAL: 1000,         // peaceful close (also: doc removed, client leave)
  GOING_AWAY: 1001,     // server shutdown
  POLICY_VIOLATION: 1008, // malformed / oversized payload, abuse
  FILE_UNSHARED: 4001,  // host unshared the file (or never shared it)
};
