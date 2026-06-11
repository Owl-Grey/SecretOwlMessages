import { base64ToBytes, bytesToBase64, bytesToText, textToBytes } from './encoding.js';

const PBKDF2_ITERATIONS = 250000;
const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function importPassword(password) {
  return crypto.subtle.importKey('raw', textToBytes(password), 'PBKDF2', false, ['deriveKey']);
}

export async function deriveStorageKey(password, salt) {
  if (!password) throw new Error('Storage password is required');
  const baseKey = await importPassword(password);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateDeviceKeyPair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
}

export async function exportPublicKeyJwk(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey);
}

export async function importPublicKeyJwk(jwk) {
  const parsed = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
  return crypto.subtle.importKey('jwk', parsed, ECDH_PARAMS, true, []);
}

async function exportPrivateKeyJwk(privateKey) {
  return crypto.subtle.exportKey('jwk', privateKey);
}

async function importPrivateKeyJwk(jwk) {
  return crypto.subtle.importKey('jwk', jwk, ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
}

export async function encryptPrivateKey(privateKey, storagePassword) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const storageKey = await deriveStorageKey(storagePassword, salt);
  const privateJwk = await exportPrivateKeyJwk(privateKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    storageKey,
    textToBytes(JSON.stringify(privateJwk))
  );
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptPrivateKey(encryptedPrivateKey, storagePassword) {
  const payload = typeof encryptedPrivateKey === 'string'
    ? JSON.parse(encryptedPrivateKey)
    : encryptedPrivateKey;
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const storageKey = await deriveStorageKey(storagePassword, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, storageKey, ciphertext);
  return importPrivateKeyJwk(JSON.parse(bytesToText(new Uint8Array(plain))));
}

async function importAesRaw(keyBytes, usages) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, usages);
}

async function exportAesRaw(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

export async function generateAesKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportRawAesKey(key) {
  return exportAesRaw(key);
}

export async function importRawAesKey(raw, usages = ['encrypt', 'decrypt']) {
  return importAesRaw(raw instanceof Uint8Array ? raw : new Uint8Array(raw), usages);
}

async function deriveWrappingKey(localPrivateKey, remotePublicKey, context) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePublicKey },
    localPrivateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: textToBytes('emergency-chat-v1'),
      info: textToBytes(context)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptTextForRecipients({
  plaintext,
  senderPrivateKey,
  senderPublicKey,
  senderUserId,
  senderDeviceId,
  recipients
}) {
  if (!plaintext.trim()) throw new Error('Message is empty');
  if (!recipients.length) throw new Error('No recipient devices with public keys');

  const messageKeyBytes = randomBytes(32);
  const messageKey = await importAesRaw(messageKeyBytes, ['encrypt', 'decrypt']);
  const messageNonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: messageNonce },
    messageKey,
    textToBytes(plaintext)
  );
  const senderPublicJwk = await exportPublicKeyJwk(senderPublicKey);

  const wrappedRecipients = [];
  for (const recipient of recipients) {
    const remotePublicKey = await importPublicKeyJwk(recipient.publicKey);
    const wrapNonce = randomBytes(12);
    const context = `${senderDeviceId}:${recipient.deviceId}`;
    const wrappingKey = await deriveWrappingKey(senderPrivateKey, remotePublicKey, context);
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapNonce },
      wrappingKey,
      messageKeyBytes
    );
    wrappedRecipients.push({
      userId: recipient.userId,
      deviceId: recipient.deviceId,
      wrappedMessageKey: bytesToBase64(new Uint8Array(wrapped)),
      wrapNonce: bytesToBase64(wrapNonce)
    });
  }

  return JSON.stringify({
    version: 2,
    type: 'text',
    algorithm: 'ECDH-P256+AES-GCM',
    senderUserId,
    senderDeviceId,
    senderPublicKey: senderPublicJwk,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    messageNonce: bytesToBase64(messageNonce),
    recipients: wrappedRecipients,
    createdAt: Date.now()
  });
}

async function wrapRawKeyForRecipients({ rawKey, recipients, senderPrivateKey, senderDeviceId, wrapFieldName }) {
  const wrappedRecipients = [];
  for (const recipient of recipients) {
    const remotePublicKey = await importPublicKeyJwk(recipient.publicKey);
    const wrapNonce = randomBytes(12);
    const context = `${senderDeviceId}:${recipient.deviceId}`;
    const wrappingKey = await deriveWrappingKey(senderPrivateKey, remotePublicKey, context);
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapNonce },
      wrappingKey,
      rawKey
    );
    wrappedRecipients.push({
      userId: recipient.userId,
      deviceId: recipient.deviceId,
      [wrapFieldName]: bytesToBase64(new Uint8Array(wrapped)),
      wrapNonce: bytesToBase64(wrapNonce)
    });
  }
  return wrappedRecipients;
}

export async function encryptArrayBuffer(arrayBuffer, aesKey) {
  const nonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, arrayBuffer);
  return {
    ciphertext,
    nonce: bytesToBase64(nonce)
  };
}

export async function decryptArrayBuffer(ciphertextArrayBuffer, aesKey, nonce) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(nonce) },
    aesKey,
    ciphertextArrayBuffer
  );
}

export async function encryptJsonMetadata(metadata, aesKey) {
  const nonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    textToBytes(JSON.stringify(metadata))
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    nonce: bytesToBase64(nonce)
  };
}

export async function decryptJsonMetadata(ciphertext, aesKey, nonce) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(nonce) },
    aesKey,
    base64ToBytes(ciphertext)
  );
  return JSON.parse(bytesToText(new Uint8Array(plaintext)));
}

export async function encryptFilePayloadForRecipients({
  file,
  fileId,
  encryptedFileSize,
  encryptedFileNonce,
  kind,
  caption = '',
  senderPrivateKey,
  senderPublicKey,
  senderUserId,
  senderDeviceId,
  recipients,
  fileKey
}) {
  const rawFileKey = await exportRawAesKey(fileKey);
  const metadata = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    kind,
    caption
  };
  const encryptedMetadata = await encryptJsonMetadata(metadata, fileKey);
  const wrappedRecipients = await wrapRawKeyForRecipients({
    rawKey: rawFileKey,
    recipients,
    senderPrivateKey,
    senderDeviceId,
    wrapFieldName: 'wrappedFileKey'
  });
  const senderPublicJwk = await exportPublicKeyJwk(senderPublicKey);

  return JSON.stringify({
    version: 2,
    type: 'file',
    algorithm: 'ECDH-P256+AES-GCM',
    senderUserId,
    senderDeviceId,
    senderPublicKey: senderPublicJwk,
    file: {
      fileId,
      encryptedFileSize,
      fileNonce: encryptedFileNonce,
      kind
    },
    metadataCiphertext: encryptedMetadata.ciphertext,
    metadataNonce: encryptedMetadata.nonce,
    recipients: wrappedRecipients,
    createdAt: Date.now()
  });
}

export async function encryptImportedFilePayloadForCurrentDevice({
  metadata,
  fileDescriptor,
  rawFileKey,
  senderPrivateKey,
  senderPublicKey,
  senderUserId,
  senderDeviceId,
  currentUserId,
  currentDeviceId,
  currentPublicKey
}) {
  const fileKey = await importRawAesKey(base64ToBytes(rawFileKey), ['encrypt', 'decrypt']);
  const encryptedMetadata = await encryptJsonMetadata(metadata, fileKey);
  const wrappedRecipients = await wrapRawKeyForRecipients({
    rawKey: base64ToBytes(rawFileKey),
    recipients: [{
      userId: currentUserId,
      deviceId: currentDeviceId,
      publicKey: currentPublicKey
    }],
    senderPrivateKey,
    senderDeviceId,
    wrapFieldName: 'wrappedFileKey'
  });

  return JSON.stringify({
    version: 2,
    type: 'file',
    algorithm: 'ECDH-P256+AES-GCM',
    senderUserId,
    senderDeviceId,
    senderPublicKey: await exportPublicKeyJwk(senderPublicKey),
    file: fileDescriptor,
    metadataCiphertext: encryptedMetadata.ciphertext,
    metadataNonce: encryptedMetadata.nonce,
    recipients: wrappedRecipients,
    createdAt: Date.now()
  });
}

export async function unwrapAesKeyFromPayload({ encryptedPayload, localPrivateKey, currentUserId, currentDeviceId, wrappedKeyField }) {
  const payload = typeof encryptedPayload === 'string' ? JSON.parse(encryptedPayload) : encryptedPayload;
  const recipient = payload.recipients?.find((item) =>
    item.deviceId === currentDeviceId && (!item.userId || item.userId === currentUserId)
  );
  if (!recipient) throw new Error('This message was not encrypted for this device');
  const wrappedKey = recipient[wrappedKeyField] || recipient.wrappedMessageKey || recipient.wrappedFileKey;
  if (!wrappedKey) throw new Error('Missing wrapped key');
  const senderPublicKey = await importPublicKeyJwk(payload.senderPublicKey);
  const context = `${payload.senderDeviceId}:${currentDeviceId}`;
  const wrappingKey = await deriveWrappingKey(localPrivateKey, senderPublicKey, context);
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(recipient.wrapNonce) },
    wrappingKey,
    base64ToBytes(wrappedKey)
  );
  return importRawAesKey(new Uint8Array(rawKey), ['encrypt', 'decrypt']);
}

export async function decryptAttachmentMetadata({ encryptedPayload, localPrivateKey, currentUserId, currentDeviceId }) {
  const payload = JSON.parse(encryptedPayload);
  const fileKey = await unwrapAesKeyFromPayload({
    encryptedPayload: payload,
    localPrivateKey,
    currentUserId,
    currentDeviceId,
    wrappedKeyField: 'wrappedFileKey'
  });
  const metadata = await decryptJsonMetadata(payload.metadataCiphertext, fileKey, payload.metadataNonce);
  return { payload, fileKey, metadata };
}

export async function encryptSyncPackageForDevice({
  syncData,
  senderPrivateKey,
  senderPublicKey,
  fromUserId,
  fromDeviceId,
  targetUserId,
  targetDeviceId,
  targetPublicKey
}) {
  const syncKey = await generateAesKey();
  const rawSyncKey = await exportRawAesKey(syncKey);
  const syncNonce = randomBytes(12);
  const encryptedSyncData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: syncNonce },
    syncKey,
    textToBytes(JSON.stringify(syncData))
  );
  const wrappingKey = await deriveWrappingKey(senderPrivateKey, await importPublicKeyJwk(targetPublicKey), `${fromDeviceId}:${targetDeviceId}`);
  const wrapNonce = randomBytes(12);
  const wrappedSyncKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapNonce },
    wrappingKey,
    rawSyncKey
  );

  return JSON.stringify({
    version: 1,
    type: 'device_history_sync',
    algorithm: 'ECDH-P256+AES-GCM',
    fromUserId,
    fromDeviceId,
    targetUserId,
    targetDeviceId,
    senderPublicKey: await exportPublicKeyJwk(senderPublicKey),
    encryptedSyncData: bytesToBase64(new Uint8Array(encryptedSyncData)),
    syncNonce: bytesToBase64(syncNonce),
    wrappedSyncKey: bytesToBase64(new Uint8Array(wrappedSyncKey)),
    wrapNonce: bytesToBase64(wrapNonce),
    createdAt: Date.now()
  });
}

export async function decryptSyncPackage({ encryptedPayload, localPrivateKey, currentDeviceId }) {
  const payload = JSON.parse(encryptedPayload);
  if (payload.type !== 'device_history_sync') throw new Error('Unsupported sync package');
  if (payload.targetDeviceId !== currentDeviceId) throw new Error('Sync package is not for this device');
  const senderPublicKey = await importPublicKeyJwk(payload.senderPublicKey);
  const wrappingKey = await deriveWrappingKey(localPrivateKey, senderPublicKey, `${payload.fromDeviceId}:${currentDeviceId}`);
  const rawSyncKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.wrapNonce) },
    wrappingKey,
    base64ToBytes(payload.wrappedSyncKey)
  );
  const syncKey = await importRawAesKey(new Uint8Array(rawSyncKey), ['decrypt']);
  const syncData = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.syncNonce) },
    syncKey,
    base64ToBytes(payload.encryptedSyncData)
  );
  return JSON.parse(bytesToText(new Uint8Array(syncData)));
}

export async function decryptIncomingMessage({
  encryptedPayload,
  localPrivateKey,
  currentUserId,
  currentDeviceId
}) {
  const payload = JSON.parse(encryptedPayload);
  if (!['ECDH-P256+AES-GCM', 'ECDH-P256+HKDF+AES-GCM'].includes(payload.algorithm) || !Array.isArray(payload.recipients)) {
    throw new Error('Unsupported encrypted message format');
  }

  const recipient = payload.recipients.find((item) =>
    item.deviceId === currentDeviceId && (!item.userId || item.userId === currentUserId)
  );
  if (!recipient) throw new Error('This message was not encrypted for this device');

  const messageKey = await unwrapAesKeyFromPayload({
    encryptedPayload: payload,
    localPrivateKey,
    currentUserId,
    currentDeviceId,
    wrappedKeyField: 'wrappedMessageKey'
  });
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.messageNonce) },
    messageKey,
    base64ToBytes(payload.ciphertext)
  );

  return bytesToText(new Uint8Array(plaintext));
}

export async function keyFingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', textToBytes(text));
  return bytesToBase64(new Uint8Array(digest)).slice(0, 24);
}
