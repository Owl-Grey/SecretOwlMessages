import { useEffect, useRef, useState } from 'react';
import {
  decryptArrayBuffer,
  decryptAttachmentMetadata,
  decryptIncomingMessage
} from '../crypto/crypto.js';
import { downloadEncryptedFile } from '../api/filesApi.js';
import { formatTime } from '../utils/time.js';

export default function MessageList({ messages, currentUserId, currentDeviceId, localPrivateKey, onRetry }) {
  const bottomRef = useRef(null);
  const [lightboxUrl, setLightboxUrl] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <section className="messages">
      {messages.length === 0 && <p className="empty-state">No messages yet</p>}
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          currentUserId={currentUserId}
          currentDeviceId={currentDeviceId}
          localPrivateKey={localPrivateKey}
          onOpenImage={setLightboxUrl}
          onRetry={onRetry}
        />
      ))}
      <div ref={bottomRef} />
      {lightboxUrl && (
        <div className="lightbox" onClick={() => setLightboxUrl('')}>
          <button onClick={() => setLightboxUrl('')}>Close</button>
          <img src={lightboxUrl} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </section>
  );
}

function MessageBubble({ message, currentUserId, currentDeviceId, localPrivateKey, onOpenImage, onRetry }) {
  const isOutgoing = message.direction === 'outgoing' || message.direction === 'out' || message.fromUserId === currentUserId;

  return (
    <article className={['message', isOutgoing ? 'outgoing' : 'incoming'].join(' ')}>
      {message.payloadType === 'image' || message.payloadType === 'file' ? (
        <AttachmentBubble
          message={message}
          currentUserId={currentUserId}
          currentDeviceId={currentDeviceId}
          localPrivateKey={localPrivateKey}
          onOpenImage={onOpenImage}
        />
      ) : (
        <TextMessage
          message={message}
          currentUserId={currentUserId}
          currentDeviceId={currentDeviceId}
          localPrivateKey={localPrivateKey}
        />
      )}
      <small>{formatTime(message.createdAt)} - {message.status}</small>
      {isOutgoing && message.status === 'failed' && (
        <button className="retry-button" onClick={() => onRetry?.(message)}>Retry</button>
      )}
    </article>
  );
}

function TextMessage({ message, currentUserId, currentDeviceId, localPrivateKey }) {
  const [text, setText] = useState('Decrypting...');
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let cancelled = false;
    decryptIncomingMessage({
      encryptedPayload: message.encryptedPayload,
      localPrivateKey,
      currentUserId,
      currentDeviceId
    }).then((value) => {
      if (!cancelled) {
        setText(value);
        setOk(true);
      }
    }).catch((error) => {
      if (!cancelled) {
        setText(error.message === 'This message was not encrypted for this device'
          ? error.message
          : 'Unable to decrypt message');
        setOk(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message.encryptedPayload, localPrivateKey, currentUserId, currentDeviceId]);

  return <p className={ok ? '' : 'decrypt-error'}>{text}</p>;
}

function AttachmentBubble({ message, currentUserId, currentDeviceId, localPrivateKey, onOpenImage }) {
  const [attachment, setAttachment] = useState(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    decryptAttachmentMetadata({
      encryptedPayload: message.encryptedPayload,
      localPrivateKey,
      currentUserId,
      currentDeviceId
    }).then((value) => {
      if (!cancelled) {
        setAttachment(value);
        setError('');
      }
    }).catch(() => {
      if (!cancelled) setError('Unable to decrypt attachment');
    });
    return () => {
      cancelled = true;
    };
  }, [message.encryptedPayload, localPrivateKey, currentUserId, currentDeviceId]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  async function loadAttachment() {
    if (!attachment || busy) return;
    setBusy(true);
    setError('');
    try {
      const encryptedBlob = await downloadEncryptedFile(attachment.payload.file.fileId);
      const plainBuffer = await decryptArrayBuffer(
        await encryptedBlob.arrayBuffer(),
        attachment.fileKey,
        attachment.payload.file.fileNonce
      );
      const blob = new Blob([plainBuffer], {
        type: attachment.metadata.mimeType || 'application/octet-stream'
      });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const url = URL.createObjectURL(blob);
      if (attachment.metadata.kind === 'image') {
        setObjectUrl(url);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.metadata.fileName || 'download';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
    } catch (downloadError) {
      setError(downloadError.message || 'File download failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !attachment) {
    return <p className="decrypt-error">{error}</p>;
  }

  if (!attachment) {
    return <p>Loading attachment...</p>;
  }

  const { metadata } = attachment;
  const isImage = metadata.kind === 'image';

  return (
    <div className="attachment-bubble">
      <div className="attachment-title">
        <strong>{isImage ? 'Image' : 'File'}</strong>
        <span>{metadata.fileName}</span>
      </div>
      <small>{formatBytes(metadata.sizeBytes)}</small>
      {isImage && objectUrl && (
        <button className="image-preview" onClick={() => onOpenImage(objectUrl)}>
          <img src={objectUrl} alt={metadata.fileName || 'attachment'} />
        </button>
      )}
      <button onClick={loadAttachment} disabled={busy}>
        {isImage ? (objectUrl ? 'Reload image' : 'Load image') : 'Download'}
      </button>
      {error && <p className="decrypt-error">{error}</p>}
    </div>
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
