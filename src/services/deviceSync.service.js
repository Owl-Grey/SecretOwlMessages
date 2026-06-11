import { createSyncPackage, getSyncPackage, ackSyncPackage, listSyncPackages } from '../api/syncApi.js';
import { getMyDevices } from '../api/usersApi.js';
import { db } from '../db/db.js';
import { saveLocalMessage, ensureDirectChat } from '../db/localMessages.js';
import {
  decryptAttachmentMetadata,
  decryptIncomingMessage,
  decryptSyncPackage,
  encryptImportedFilePayloadForCurrentDevice,
  encryptSyncPackageForDevice,
  encryptTextForRecipients,
  exportRawAesKey,
  importPublicKeyJwk
} from '../crypto/crypto.js';
import { bytesToBase64 } from '../crypto/encoding.js';
import { createId } from '../utils/ids.js';
import { nowMs } from '../utils/time.js';

function parseDevicePublicKey(device) {
  try {
    return JSON.parse(device.devicePublicKey);
  } catch {
    return null;
  }
}

export async function createHistorySyncPackages({ profile, localPrivateKey }) {
  const devicesResponse = await getMyDevices();
  const devices = (devicesResponse.devices || []).filter((device) =>
    !device.revokedAt && device.id !== profile.deviceId && parseDevicePublicKey(device)
  );
  const contacts = await db.contacts.toArray();
  const chats = await db.chats.toArray();
  const localMessages = await db.messages.orderBy('createdAt').toArray();
  const exportedMessages = [];
  let skipped = 0;

  for (const message of localMessages) {
    const item = {
      id: message.id,
      serverMessageId: message.serverMessageId,
      chatId: message.chatId,
      fromUserId: message.fromUserId,
      toUserId: message.toUserId,
      direction: message.direction,
      payloadType: message.payloadType,
      createdAt: message.createdAt,
      status: message.status,
      encryptedPayloadOriginal: message.encryptedPayload
    };
    if (message.payloadType === 'text') {
      try {
        item.plainText = await decryptIncomingMessage({
          encryptedPayload: message.encryptedPayload,
          localPrivateKey,
          currentUserId: profile.userId,
          currentDeviceId: profile.deviceId
        });
      } catch {
        skipped += 1;
      }
    } else if (message.payloadType === 'image' || message.payloadType === 'file') {
      try {
        const attachment = await decryptAttachmentMetadata({
          encryptedPayload: message.encryptedPayload,
          localPrivateKey,
          currentUserId: profile.userId,
          currentDeviceId: profile.deviceId
        });
        item.fileMetadata = attachment.metadata;
        item.fileDescriptor = attachment.payload.file;
        item.rawFileKey = bytesToBase64(await exportRawAesKey(attachment.fileKey));
      } catch {
        skipped += 1;
      }
    }
    exportedMessages.push(item);
  }

  const results = [];
  const ownPublicKey = JSON.parse(profile.publicKey);
  for (const device of devices) {
    const syncData = {
      version: 1,
      type: 'device_history_sync',
      exportedAt: nowMs(),
      sourceDeviceId: profile.deviceId,
      targetDeviceId: device.id,
      profile: { userId: profile.userId, username: profile.username },
      contacts,
      chats,
      messages: exportedMessages,
      settings: {}
    };
    const encryptedPayload = await encryptSyncPackageForDevice({
      syncData,
      senderPrivateKey: localPrivateKey,
      senderPublicKey: await importPublicKeyJwk(ownPublicKey),
      fromUserId: profile.userId,
      fromDeviceId: profile.deviceId,
      targetUserId: profile.userId,
      targetDeviceId: device.id,
      targetPublicKey: parseDevicePublicKey(device)
    });
    const response = await createSyncPackage({
      fromDeviceId: profile.deviceId,
      targetDeviceId: device.id,
      encryptedPayload,
      sizeBytes: new Blob([encryptedPayload]).size
    });
    results.push({ ...response, targetDeviceName: device.deviceName || device.id });
  }

  return { packages: results, skipped };
}

export async function checkIncomingSyncPackages(profile) {
  return listSyncPackages(profile.deviceId);
}

export async function importHistorySyncPackage({ profile, localPrivateKey, packageId }) {
  const response = await getSyncPackage(packageId, profile.deviceId);
  const syncData = await decryptSyncPackage({
    encryptedPayload: response.encryptedPayload,
    localPrivateKey,
    currentDeviceId: profile.deviceId
  });

  let contacts = 0;
  let chats = 0;
  let messages = 0;
  let skipped = 0;

  for (const contact of syncData.contacts || []) {
    if (!contact.userId) continue;
    await db.contacts.put(contact);
    contacts += 1;
  }

  for (const chat of syncData.chats || []) {
    if (!chat.peerUserId) continue;
    await ensureDirectChat(chat.peerUserId, chat.displayName);
    chats += 1;
  }

  const ownPublicKey = JSON.parse(profile.publicKey);
  for (const message of syncData.messages || []) {
    const identity = message.serverMessageId
      ? await db.messages.where('serverMessageId').equals(message.serverMessageId).first()
      : await db.messages.get(message.id);
    if (identity) {
      skipped += 1;
      continue;
    }

    const peerUserId = message.fromUserId === profile.userId ? message.toUserId : message.fromUserId;
    const chat = await ensureDirectChat(peerUserId);
    let encryptedPayload = message.encryptedPayloadOriginal;

    if (message.payloadType === 'text' && message.plainText) {
      encryptedPayload = await encryptTextForRecipients({
        plaintext: message.plainText,
        senderPrivateKey: localPrivateKey,
        senderPublicKey: await importPublicKeyJwk(ownPublicKey),
        senderUserId: message.fromUserId,
        senderDeviceId: profile.deviceId,
        recipients: [{
          userId: profile.userId,
          deviceId: profile.deviceId,
          publicKey: ownPublicKey
        }]
      });
    } else if ((message.payloadType === 'image' || message.payloadType === 'file') && message.fileMetadata && message.fileDescriptor && message.rawFileKey) {
      encryptedPayload = await encryptImportedFilePayloadForCurrentDevice({
        metadata: message.fileMetadata,
        fileDescriptor: message.fileDescriptor,
        rawFileKey: message.rawFileKey,
        senderPrivateKey: localPrivateKey,
        senderPublicKey: await importPublicKeyJwk(ownPublicKey),
        senderUserId: message.fromUserId,
        senderDeviceId: profile.deviceId,
        currentUserId: profile.userId,
        currentDeviceId: profile.deviceId,
        currentPublicKey: ownPublicKey
      });
    }

    if (!encryptedPayload) {
      skipped += 1;
      continue;
    }

    await saveLocalMessage({
      id: message.id || createId(),
      serverMessageId: message.serverMessageId || null,
      chatId: chat.id,
      fromUserId: message.fromUserId,
      toUserId: message.toUserId,
      direction: message.fromUserId === profile.userId ? 'outgoing' : 'incoming',
      payloadType: message.payloadType,
      encryptedPayload,
      createdAt: message.createdAt,
      status: message.status || 'imported'
    }, { activeChatId: null });
    messages += 1;
  }

  await ackSyncPackage(packageId, profile.deviceId);
  return { contacts, chats, messages, skipped };
}
