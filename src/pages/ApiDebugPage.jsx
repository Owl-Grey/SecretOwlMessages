import { useState } from 'react';
import ApiResultBox from '../components/ApiResultBox.jsx';
import { apiRequest } from '../api/client.js';
import { me } from '../api/authApi.js';
import { getMyDevices } from '../api/usersApi.js';
import { ackMessages, pullMessages, sendMessage } from '../api/messagesApi.js';
import { appConfig } from '../config.js';
import { db } from '../db/db.js';

export default function ApiDebugPage({ profile }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [toUserId, setToUserId] = useState('');
  const [encryptedPayload, setEncryptedPayload] = useState('');
  const [ackIds, setAckIds] = useState('');

  async function run(action) {
    setError(null);
    try {
      const response = await action();
      setResult(response);
    } catch (err) {
      setError(err);
      setResult(err.data);
    }
  }

  return (
    <div className="grid two">
      <section className="panel">
        <h2>API Debug</h2>
        <div className="actions wrap">
          <button onClick={() => run(() => apiRequest('/api/health', { token: '' }))}>Health check</button>
          <button onClick={() => run(me)}>Me</button>
          <button onClick={() => run(getMyDevices)}>Devices my</button>
          <button onClick={() => run(() => pullMessages(100))}>Pull messages</button>
          <button onClick={() => run(async () => ({
            maxImageSizeMb: appConfig.maxImageSizeMb,
            maxFileSizeMb: appConfig.maxFileSizeMb,
            profiles: await db.profiles.count(),
            contacts: await db.contacts.count(),
            chats: await db.chats.count(),
            messages: await db.messages.count(),
            pendingAck: (await db.settings.get('pendingAckMessageIds'))?.value || '[]'
          }))}>Storage / limits</button>
        </div>
        <div className="stack">
          <label>toUserId<input value={toUserId} onChange={(e) => setToUserId(e.target.value)} /></label>
          <label>custom encryptedPayload<textarea value={encryptedPayload} onChange={(e) => setEncryptedPayload(e.target.value)} /></label>
          <button onClick={() => run(() => sendMessage({
            toUserId,
            fromDeviceId: profile?.deviceId || null,
            toDeviceId: null,
            payloadType: 'text',
            encryptedPayload
          }))}>Send raw encryptedPayload</button>
          <label>ACK message ids, comma separated<input value={ackIds} onChange={(e) => setAckIds(e.target.value)} /></label>
          <button onClick={() => run(() => ackMessages(ackIds.split(',').map((id) => id.trim()).filter(Boolean)))}>ACK ids</button>
        </div>
      </section>
      <ApiResultBox value={result} error={error} />
    </div>
  );
}
