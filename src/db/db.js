import Dexie from 'dexie';

export const db = new Dexie('EmergencyChatFrontendDB');

db.version(1).stores({
  profiles: 'id, username, userId, deviceId, createdAt',
  contacts: 'id, userId, username, displayName, addedAt',
  messages: 'id, serverMessageId, chatId, fromUserId, toUserId, direction, payloadType, createdAt, status',
  settings: 'key',
  outbox: 'id, toUserId, payloadType, createdAt, status, retryCount'
});

db.version(2).stores({
  profiles: 'id, username, userId, deviceId, createdAt',
  contacts: 'userId, username, displayName, addedAt',
  chats: 'id, type, peerUserId, displayName, createdAt, updatedAt, unreadCount',
  messages: 'id, serverMessageId, chatId, fromUserId, toUserId, direction, payloadType, createdAt, status',
  settings: 'key',
  outbox: 'id, toUserId, payloadType, createdAt, status, retryCount'
});

export async function wipeLocalData() {
  await db.delete();
  localStorage.clear();
  sessionStorage.clear();
  window.location.reload();
}
