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
