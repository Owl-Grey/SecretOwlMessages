import { useCallback, useEffect, useRef, useState } from 'react';
import ContactSearch from '../components/ContactSearch.jsx';
import ChatList from '../components/ChatList.jsx';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';
import { sendMessage } from '../api/messagesApi.js';
import { getKeys } from '../api/usersApi.js';
import { uploadEncryptedFile } from '../api/filesApi.js';
import {
  decryptPrivateKey,
  encryptArrayBuffer,
  encryptFilePayloadForRecipients,
  encryptTextForRecipients,
  generateAesKey,
  importPublicKeyJwk
} from '../crypto/crypto.js';
import {
  ensureDirectChat,
  listChatMessages,
  listChats,
  markChatRead,
  saveLocalMessage,
  updateMessageAfterSend,
  updateMessageStatus
} from '../db/localMessages.js';
import { createId } from '../utils/ids.js';
import { nowMs } from '../utils/time.js';
import { SyncManager } from '../services/syncManager.js';
import { appConfig } from '../config.js';
import {
  getNotificationSettings,
  shouldNotifyForMessage,
  showNewMessageNotification
} from '../services/notification.service.js';

export default function ChatPage({ profile, storagePassword, setStoragePassword, localPrivateKey, setLocalPrivateKey, go }) {
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('offline');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [unlockDraft, setUnlockDraft] = useState('');
  const [syncError, setSyncError] = useState('');
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [toast, setToast] = useState(null);
  const selectedRef = useRef(null);
  const syncManagerRef = useRef(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const reloadChats = useCallback(async () => {
    const rows = await listChats();
    setChats(rows);
    if (!selectedRef.current && rows.length > 0) {
      setSelected(rows[0]);
      await markChatRead(rows[0].id);
    }
  }, []);

  const reloadMessages = useCallback(async (chat = selectedRef.current) => {
    if (!chat) {
      setMessages([]);
      return;
    }
    setMessages(await listChatMessages(chat.id));
  }, []);

  useEffect(() => {
    if (!profile?.encryptedPrivateKey || !storagePassword) {
      setLocalPrivateKey(null);
      return;
    }
    let cancelled = false;
    decryptPrivateKey(profile.encryptedPrivateKey, storagePassword)
      .then((key) => {
        if (!cancelled) setLocalPrivateKey(key);
      })
      .catch(() => {
        if (!cancelled) {
          setLocalPrivateKey(null);
          setSyncError('Storage password cannot unlock this device key.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.encryptedPrivateKey, storagePassword]);

  useEffect(() => {
    reloadChats();
  }, [reloadChats]);

  useEffect(() => {
    reloadMessages(selected);
    if (selected) {
      markChatRead(selected.id).then(reloadChats);
    }
  }, [selected?.id, reloadMessages, reloadChats]);

  useEffect(() => {
    if (!profile?.userId || !profile?.accessToken) return undefined;
    const manager = new SyncManager({
      profile,
      getActiveChatId: () => selectedRef.current?.id,
      onUpdate: async ({ lastSyncAt: syncedAt }) => {
        await reloadChats();
        await reloadMessages();
        setLastSyncAt(syncedAt);
        setSyncError('');
      },
      onStatus: ({ status, error, lastSyncAt: syncedAt }) => {
        setConnectionStatus(status);
        if (syncedAt) setLastSyncAt(syncedAt);
        setSyncError(error || '');
      },
      onMessagesSaved: async (savedMessages) => {
        const settings = await getNotificationSettings();
        for (const message of savedMessages) {
          if (!shouldNotifyForMessage(message, selectedRef.current?.id)) continue;
          const title = 'Emergency Chat';
          const body = 'New message';
          if (settings.inApp) {
            setToast({ title, body, chatId: message.chatId });
            setTimeout(() => setToast(null), 4500);
          }
          await showNewMessageNotification({
            title,
            body,
            chatId: message.chatId,
            onClick: (chatId) => {
              const chat = chats.find((item) => item.id === chatId);
              if (chat) setSelected(chat);
            }
          });
        }
      }
    });
    syncManagerRef.current = manager;
    manager.startSync();
    return () => {
      manager.stopSync();
      if (syncManagerRef.current === manager) syncManagerRef.current = null;
    };
  }, [profile?.userId, profile?.accessToken, profile?.wsUrl, reloadChats, reloadMessages]);

  useEffect(() => {
    if (localPrivateKey) {
      syncManagerRef.current?.pullMessages('unlock');
    }
  }, [localPrivateKey]);

  async function onContactAdded(contact) {
    await reloadChats();
    const chat = await ensureDirectChat(contact.userId, contact.displayName || contact.username);
    setSelected(chat);
  }

  async function getRecipientDevices(peerUserId) {
      const recipientKeys = await getKeys(selected.peerUserId);
      const recipientDevices = [];
      for (const device of recipientKeys.devices || []) {
        try {
          const publicKey = JSON.parse(device.devicePublicKey);
          await importPublicKeyJwk(publicKey);
          recipientDevices.push({
            userId: selected.peerUserId,
            deviceId: device.deviceId,
            publicKey
          });
        } catch {
          // Ignore pre-ECDH MVP devices or malformed keys.
        }
      }
      const ownPublicKey = profile.publicKey ? JSON.parse(profile.publicKey) : null;
      if (!ownPublicKey) throw new Error('Local public key is missing');
      if (recipientDevices.length === 0) {
        throw new Error('Recipient has no active ECDH device key. Re-login or register that user again.');
      }
    return {
      ownPublicKey,
      recipientDevices: [
        ...recipientDevices,
        {
          userId: profile.userId,
          deviceId: profile.deviceId,
          publicKey: ownPublicKey
        }
      ]
    };
  }

  async function saveAndSendEncryptedMessage({ encryptedPayload, payloadType, optimisticId, timestamp }) {
    const chatId = selected.id;
    await saveLocalMessage({
      id: optimisticId,
      chatId,
      fromUserId: profile.userId,
      toUserId: selected.peerUserId,
      direction: 'outgoing',
      payloadType,
      encryptedPayload,
      createdAt: timestamp,
      status: 'pending'
    }, { activeChatId: chatId });
    await reloadChats();
    await reloadMessages(selected);

    const response = await sendMessage({
      toUserId: selected.peerUserId,
      fromDeviceId: profile.deviceId,
      toDeviceId: null,
      payloadType,
      encryptedPayload
    });
    await updateMessageAfterSend(optimisticId, response.id, 'sent');
    await reloadChats();
    await reloadMessages(selected);
  }

  async function send(text) {
    if (!selected || !profile || !localPrivateKey) return;
    const optimisticId = createId();
    const timestamp = nowMs();

    try {
      const { ownPublicKey, recipientDevices } = await getRecipientDevices(selected.peerUserId);

      const encryptedPayload = await encryptTextForRecipients({
        plaintext: text,
        senderPrivateKey: localPrivateKey,
        senderPublicKey: await importPublicKeyJwk(ownPublicKey),
        senderUserId: profile.userId,
        senderDeviceId: profile.deviceId,
        recipients: recipientDevices
      });

      await saveAndSendEncryptedMessage({
        encryptedPayload,
        payloadType: 'text',
        optimisticId,
        timestamp
      });
    } catch (error) {
      await updateMessageStatus(optimisticId, 'failed');
      setSyncError(error.message || 'Send failed');
      await reloadMessages(selected);
    }
  }

  async function sendAttachment(file) {
    if (!selected || !profile || !localPrivateKey) return;
    const kind = appConfig.allowedImageTypes.includes(file.type) ? 'image' : 'file';
    const maxBytes = kind === 'image' ? appConfig.maxImageSizeBytes : appConfig.maxFileSizeBytes;
    const maxMb = kind === 'image' ? appConfig.maxImageSizeMb : appConfig.maxFileSizeMb;
    if (file.size > maxBytes) {
      setSyncError(`${kind === 'image' ? 'Image' : 'File'} is too large. Max ${maxMb} MB.`);
      return;
    }

    const optimisticId = createId();
    const timestamp = nowMs();
    try {
      setAttachmentStatus('Encrypting...');
      const { ownPublicKey, recipientDevices } = await getRecipientDevices(selected.peerUserId);
      const fileKey = await generateAesKey();
      const encryptedFile = await encryptArrayBuffer(await file.arrayBuffer(), fileKey);
      const encryptedBlob = new Blob([encryptedFile.ciphertext], { type: 'application/octet-stream' });

      setAttachmentStatus('Uploading...');
      const upload = await uploadEncryptedFile({
        encryptedBlob,
        recipientUserId: selected.peerUserId,
        mimeType: 'application/octet-stream'
      });

      const encryptedPayload = await encryptFilePayloadForRecipients({
        file,
        fileId: upload.fileId,
        encryptedFileSize: upload.sizeBytes,
        encryptedFileNonce: encryptedFile.nonce,
        kind,
        senderPrivateKey: localPrivateKey,
        senderPublicKey: await importPublicKeyJwk(ownPublicKey),
        senderUserId: profile.userId,
        senderDeviceId: profile.deviceId,
        recipients: recipientDevices,
        fileKey
      });

      setAttachmentStatus('Sending...');
      await saveAndSendEncryptedMessage({
        encryptedPayload,
        payloadType: kind,
        optimisticId,
        timestamp
      });
      setAttachmentStatus('');
    } catch (error) {
      await updateMessageStatus(optimisticId, 'failed');
      setAttachmentStatus('');
      setSyncError(error.message || 'Attachment send failed');
      await reloadMessages(selected);
    }
  }

  async function retryMessage(message) {
    if (!selected || !profile || message.status !== 'failed') return;
    try {
      await updateMessageStatus(message.id, 'pending');
      await reloadMessages(selected);
      const response = await sendMessage({
        toUserId: message.toUserId,
        fromDeviceId: profile.deviceId,
        toDeviceId: null,
        payloadType: message.payloadType,
        encryptedPayload: message.encryptedPayload
      });
      await updateMessageAfterSend(message.id, response.id, 'sent');
    } catch (error) {
      await updateMessageStatus(message.id, 'failed');
      setSyncError(error.message || 'Retry failed');
    } finally {
      await reloadMessages(selected);
      await reloadChats();
    }
  }

  if (!profile) {
    return <section className="auth-card"><h2>Login required</h2><button onClick={() => go('login')}>Login</button></section>;
  }

  if (!localPrivateKey) {
    return (
      <div className="unlock-screen">
        <section className="unlock-card">
          <h1>Unlock Emergency Chat</h1>
          <p>Enter the storage password for this device to decrypt your local private key.</p>
          <form
            className="unlock-form vertical"
            onSubmit={(event) => {
              event.preventDefault();
              setStoragePassword(unlockDraft);
            }}
          >
            <input
              type="password"
              value={unlockDraft}
              onChange={(event) => setUnlockDraft(event.target.value)}
              placeholder="Storage password"
            />
            <button disabled={!unlockDraft}>Unlock</button>
          </form>
          {syncError && <p className="form-error">{syncError}</p>}
          <div className="actions">
            <button onClick={() => go('login')}>Account login</button>
            <button onClick={() => go('settings')}>Settings</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="messenger-shell">
      <aside className="messenger-sidebar">
        <div className="brand-row">
          <div>
            <h1>Emergency Chat</h1>
            <p>{profile.username}</p>
          </div>
          <button aria-label="Settings" onClick={() => go('settings')}>Settings</button>
        </div>
        <div className={`connection-pill ${connectionStatus}`}>
          <span>{connectionStatus}</span>
          <small>{lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : 'not synced'}</small>
        </div>
        <ContactSearch onAdded={onContactAdded} onResult={() => {}} />
        <ChatList chats={chats} selectedId={selected?.id} onSelect={setSelected} />
        <button className="debug-link" onClick={() => go('debug')}>Debug</button>
      </aside>
      {toast && (
        <button className="toast" onClick={() => setToast(null)}>
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}
      <section className="conversation">
        {selected ? (
          <>
            <header className="conversation-header">
              <div>
                <h2>{selected.displayName}</h2>
                <p>{selected.peerUserId}</p>
              </div>
              <span>{syncError || (localPrivateKey ? 'Encryption ready' : 'Storage locked')}</span>
            </header>
            <MessageList
              messages={messages}
              currentUserId={profile.userId}
              currentDeviceId={profile.deviceId}
              localPrivateKey={localPrivateKey}
              onRetry={retryMessage}
            />
            <MessageInput
              disabled={!selected || !localPrivateKey}
              onSend={send}
              onAttach={sendAttachment}
              attachmentStatus={attachmentStatus}
            />
          </>
        ) : (
          <div className="select-chat">
            <h2>Select a chat</h2>
            <p>Add a contact by username or wait for an incoming message.</p>
          </div>
        )}
      </section>
    </div>
  );
}
