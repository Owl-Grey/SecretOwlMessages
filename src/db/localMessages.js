import { db } from './db.js';
import { createId } from '../utils/ids.js';
import { nowMs } from '../utils/time.js';

export function chatIdFor(userA, userB) {
  return [userA, userB].sort().join(':');
}

export function shortUserId(userId) {
  if (!userId) return 'Unknown';
  return `${userId.slice(0, 8)}...${userId.slice(-4)}`;
}

export async function getDisplayName(userId) {
  const contact = await db.contacts.get(userId);
  return contact?.displayName || contact?.username || shortUserId(userId);
}

export async function addContact(contact) {
  const userId = contact.userId;
  const displayName = contact.displayName || contact.username || shortUserId(userId);
  await db.contacts.put({
    userId,
    username: contact.username || null,
    displayName,
    addedAt: contact.addedAt || nowMs()
  });
  await ensureDirectChat(userId, displayName);
  return db.contacts.get(userId);
}

export async function ensureDirectChat(peerUserId, displayName) {
  const id = `direct:${peerUserId}`;
  const existing = await db.chats.get(id);
  const timestamp = nowMs();
  const name = displayName || await getDisplayName(peerUserId);
  const chat = {
    id,
    type: 'direct',
    peerUserId,
    displayName: name,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    unreadCount: existing?.unreadCount || 0
  };
  await db.chats.put(chat);
  return chat;
}

export async function listChats() {
  return db.chats.orderBy('updatedAt').reverse().toArray();
}

export async function markChatRead(chatId) {
  const chat = await db.chats.get(chatId);
  if (chat) await db.chats.put({ ...chat, unreadCount: 0 });
}

export async function saveLocalMessage(message, { activeChatId } = {}) {
  const id = message.id || createId();
  const existing = await db.messages.get(id);
  if (existing) return existing;

  await db.messages.put({
    id,
    serverMessageId: message.serverMessageId || null,
    chatId: message.chatId,
    fromUserId: message.fromUserId,
    toUserId: message.toUserId,
    direction: message.direction,
    payloadType: message.payloadType || 'text',
    encryptedPayload: message.encryptedPayload,
    createdAt: message.createdAt || nowMs(),
    status: message.status || 'stored'
  });

  const chat = await db.chats.get(message.chatId);
  if (chat) {
    await db.chats.put({
      ...chat,
      updatedAt: message.createdAt || nowMs(),
      unreadCount: (message.direction === 'incoming' || message.direction === 'in') && activeChatId !== message.chatId
        ? (chat.unreadCount || 0) + 1
        : chat.unreadCount || 0
    });
  }

  return db.messages.get(id);
}

export async function updateMessageStatus(id, status) {
  const message = await db.messages.get(id);
  if (message) await db.messages.put({ ...message, status });
}

export async function updateMessageAfterSend(id, serverMessageId, status = 'sent') {
  const message = await db.messages.get(id);
  if (message) await db.messages.put({ ...message, serverMessageId, status });
}

export async function listChatMessages(chatId) {
  return db.messages.where('chatId').equals(chatId).sortBy('createdAt');
}

export async function savePulledMessages(messages, currentUserId, { activeChatId } = {}) {
  const saved = [];
  for (const message of messages) {
    const otherUserId = message.fromUserId === currentUserId ? message.toUserId : message.fromUserId;
    const displayName = await getDisplayName(otherUserId);
    const chat = await ensureDirectChat(otherUserId, displayName);
    const row = await saveLocalMessage({
      id: `server:${message.id}`,
      serverMessageId: message.id,
      chatId: chat.id,
      fromUserId: message.fromUserId,
      toUserId: message.toUserId,
      direction: message.fromUserId === currentUserId ? 'outgoing' : 'incoming',
      payloadType: message.payloadType,
      encryptedPayload: message.encryptedPayload,
      createdAt: message.createdAt,
      status: 'delivered'
    }, { activeChatId });
    saved.push(row);
  }
  return saved;
}
