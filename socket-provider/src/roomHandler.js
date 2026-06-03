// Room control channel handler — JSON messages over /room/:roomId.

import { Room } from './room.js';
import {
  CONTROL,
  OUT,
  CURSOR_COLORS,
  MAX_FILE_CONTENT_BYTES,
  MAX_FILE_ID_LEN,
  MAX_SHARED_FILES_PER_ROOM,
  MAX_REORDER_LIST_LEN,
  MAX_CHAT_LEN,
  CHAT_WINDOW_MS,
  CHAT_BURST,
} from './constants.js';
import {
  generateId,
  sendJson,
  safeJsonParse,
  sanitizeStr,
  sanitizeColor,
} from './util.js';
import { log } from './log.js';

/**
 * @param {object} deps
 * @param {Map<string, Room>} deps.rooms
 * @param {import('./docs.js').DocRegistry} deps.docs
 */
export function createRoomHandler({ rooms, docs }) {
  /**
   * @param {import('ws').WebSocket} ws
   * @param {string} roomId
   */
  return function handleRoomConnection(ws, roomId) {
    const peerId = generateId('peer');
    /** @type {Room | undefined} */
    let room = rooms.get(roomId);
    let joined = false;
    // Sliding window: timestamps of recent chat messages from this peer.
    /** @type {number[]} */
    const chatTimes = [];

    log.debug('room', `connection ${peerId} -> ${roomId}`);

    ws.on('message', (rawData) => {
      const msg = safeJsonParse(rawData);
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case CONTROL.PING:
          sendJson(ws, { type: OUT.PONG, t: Date.now() });
          return;

        case CONTROL.CREATE: {
          if (room) {
            sendJson(ws, { type: OUT.ERROR, message: 'Room already exists' });
            return;
          }
          const displayName = sanitizeStr(msg.displayName, 'Host', 40);
          const color = sanitizeColor(msg.color, CURSOR_COLORS[0]);
          room = new Room(roomId);
          room.addHost(peerId, ws, displayName, color);
          rooms.set(roomId, room);
          joined = true;
          sendJson(ws, { type: OUT.ROOM_CREATED, peerId, roomId });
          room.broadcastMembersUpdate();
          log.info('room', `created ${roomId} host=${peerId} (${displayName})`);
          return;
        }

        case CONTROL.JOIN: {
          if (!room) {
            sendJson(ws, { type: OUT.ERROR, message: 'Room does not exist' });
            return;
          }
          const displayName = sanitizeStr(msg.displayName, 'Guest', 40);
          const color = sanitizeColor(msg.color, CURSOR_COLORS[1]);
          room.addPending(peerId, ws, displayName, color);
          joined = true;
          sendJson(ws, { type: OUT.WAITING_APPROVAL, peerId });
          room.sendTo(room.hostId, {
            type: OUT.JOIN_REQUEST,
            peerId,
            displayName,
            color,
          });
          room.broadcastMembersUpdate();
          log.info('room', `join-request ${roomId} ${peerId} (${displayName})`);
          return;
        }

        case CONTROL.APPROVE: {
          if (!room || !room.isHost(peerId)) return;
          const target = typeof msg.peerId === 'string' ? msg.peerId : '';
          const member = room.approve(target);
          if (!member) return;
          sendJson(member.ws, {
            type: OUT.APPROVED,
            peerId: target,
            sharedFiles: room.getSharedFilesList(),
          });
          room.broadcastMembersUpdate();
          log.info('room', `approved ${roomId} ${target}`);
          return;
        }

        case CONTROL.REJECT: {
          if (!room || !room.isHost(peerId)) return;
          const target = typeof msg.peerId === 'string' ? msg.peerId : '';
          const rejected = room.removePending(target);
          if (!rejected) return;
          sendJson(rejected.ws, { type: OUT.REJECTED });
          room.broadcastMembersUpdate();
          log.info('room', `rejected ${roomId} ${target}`);
          return;
        }

        case CONTROL.SHARE_FILE: {
          if (!room || !room.isHost(peerId)) return;
          const file = msg.file;
          if (!file || typeof file.id !== 'string') return;
          if (file.id.length === 0 || file.id.length > MAX_FILE_ID_LEN) return;
          const content = typeof file.content === 'string' ? file.content : '';
          // Bytes, not chars — file.content may contain multi-byte chars.
          if (Buffer.byteLength(content, 'utf8') > MAX_FILE_CONTENT_BYTES) {
            sendJson(ws, { type: OUT.ERROR, message: 'File is too large to share' });
            return;
          }
          if (
            !room.hasSharedFile(file.id) &&
            room.sharedFiles.size >= MAX_SHARED_FILES_PER_ROOM
          ) {
            sendJson(ws, { type: OUT.ERROR, message: 'Too many shared files in this room' });
            return;
          }
          const name = sanitizeStr(file.name, 'untitled', 200);
          const language = sanitizeStr(file.language, '', 40);
          room.addSharedFile({ id: file.id, name, language, content });
          docs.seed(`${roomId}/${file.id}`, content);
          room.broadcastJson({
            type: OUT.FILE_SHARED,
            file: { id: file.id, name, language },
          });
          log.debug('room', `shared ${roomId}/${file.id}`);
          return;
        }

        case CONTROL.REORDER_FILES: {
          if (!room || !room.isHost(peerId)) return;
          if (!Array.isArray(msg.files)) return;
          if (msg.files.length > MAX_REORDER_LIST_LEN) return;
          room.reorderSharedFiles(msg.files);
          room.broadcastJson({
            type: OUT.FILES_REORDERED,
            sharedFiles: room.getSharedFilesList(),
          });
          return;
        }

        case CONTROL.UNSHARE_FILE: {
          if (!room || !room.isHost(peerId)) return;
          const fileId = typeof msg.fileId === 'string' ? msg.fileId : '';
          if (!fileId || fileId.length > MAX_FILE_ID_LEN) return;
          if (!room.removeSharedFile(fileId)) return;
          room.broadcastJson({ type: OUT.FILE_UNSHARED, fileId });
          docs.destroy(`${roomId}/${fileId}`);
          log.debug('room', `unshared ${roomId}/${fileId}`);
          return;
        }

        case CONTROL.CHAT_MESSAGE: {
          if (!room || !room.hasMember(peerId)) return;
          const now = Date.now();
          while (chatTimes.length && now - chatTimes[0] > CHAT_WINDOW_MS) {
            chatTimes.shift();
          }
          if (chatTimes.length >= CHAT_BURST) return; // silently drop
          chatTimes.push(now);

          const text = sanitizeStr(msg.text, '', MAX_CHAT_LEN);
          if (!text) return;
          const member = room.members.get(peerId);
          const chatMsg = {
            type: OUT.CHAT_MESSAGE,
            id: generateId('chat'),
            peerId,
            displayName: member.displayName,
            color: member.color,
            text,
            timestamp: now,
          };
          room.broadcastJson(chatMsg);
          return;
        }

        case CONTROL.LEAVE:
          handleDisconnect();
          return;
      }
    });

    ws.on('close', handleDisconnect);
    ws.on('error', () => handleDisconnect());

    function handleDisconnect() {
      if (!joined || !room) return;
      joined = false;

      const wasMember = room.hasMember(peerId);
      const member = room.removeMember(peerId);
      const pendingEntry = room.removePending(peerId);
      const displayName = member?.displayName || pendingEntry?.displayName || 'Unknown';

      if (wasMember) {
        room.broadcastJson({ type: OUT.PEER_LEFT, peerId, displayName });
      }

      if (room.isHost(peerId) || room.hostId === peerId) {
        // host left — promote next or close
        const newHostId = room.promoteNextHost();
        if (newHostId) {
          room.sendTo(newHostId, { type: OUT.PROMOTED_TO_HOST });
          room.broadcastMembersUpdate();
          log.info('room', `host promoted ${roomId} -> ${newHostId}`);
        } else {
          // Empty room — reject pending, destroy docs, drop room
          for (const [, p] of room.pending) {
            sendJson(p.ws, { type: OUT.ROOM_CLOSED });
          }
          room.pending.clear();
          docs.destroyByPrefix(`${room.roomId}/`);
          rooms.delete(room.roomId);
          log.info('room', `closed ${room.roomId}`);
        }
      } else {
        room.broadcastMembersUpdate();
      }
    }
  };
}
