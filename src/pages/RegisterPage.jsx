import { useEffect, useState } from 'react';
import { register } from '../api/authApi.js';
import ApiResultBox from '../components/ApiResultBox.jsx';
import { getSetting, saveProfile, saveSetting } from '../db/localProfile.js';
import {
  encryptPrivateKey,
  exportPublicKeyJwk,
  generateDeviceKeyPair,
  keyFingerprint
} from '../crypto/crypto.js';

const envApi = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';
const envWs = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:3000/ws';

export default function RegisterPage({ setProfile, storagePassword, setStoragePassword, go }) {
  const [form, setForm] = useState({
    apiBaseUrl: envApi,
    wsUrl: envWs,
    username: '',
    password: '',
    deviceName: 'Browser',
    inviteCode: ''
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getSetting('apiBaseUrl'), getSetting('wsUrl')]).then(([apiBaseUrl, wsUrl]) => {
      setForm((current) => ({
        ...current,
        apiBaseUrl: apiBaseUrl || current.apiBaseUrl,
        wsUrl: wsUrl || current.wsUrl
      }));
    });
  }, []);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      if (!storagePassword) throw new Error('Storage password is required');
      const keyPair = await generateDeviceKeyPair();
      const publicKey = await exportPublicKeyJwk(keyPair.publicKey);
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, storagePassword);
      const fingerprint = await keyFingerprint(publicKey);

      const response = await register({
        username: form.username,
        password: form.password,
        inviteCode: form.inviteCode || undefined,
        deviceName: form.deviceName,
        devicePublicKey: JSON.stringify(publicKey),
        keyFingerprint: fingerprint
      }, form.apiBaseUrl);

      const saved = await saveProfile({
        username: response.user.username,
        userId: response.user.id,
        deviceId: response.device.id,
        accessToken: response.accessToken,
        encryptedPrivateKey: JSON.stringify(encryptedPrivateKey),
        publicKey: JSON.stringify(publicKey),
        salt: encryptedPrivateKey.salt,
        apiBaseUrl: form.apiBaseUrl,
        wsUrl: form.wsUrl
      });
      await saveSetting('apiBaseUrl', form.apiBaseUrl);
      await saveSetting('wsUrl', form.wsUrl);
      setProfile(saved);
      setResult({ user: response.user, device: response.device });
      go('chat');
    } catch (err) {
      setError(err);
      setResult(err.data);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <h2>Create account</h2>
        <form onSubmit={submit} className="stack">
          <label>Username<input value={form.username} onChange={(e) => update('username', e.target.value)} /></label>
          <label>Account password<input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} /></label>
          <label>Device name<input value={form.deviceName} onChange={(e) => update('deviceName', e.target.value)} /></label>
          <label>Storage password<input type="password" value={storagePassword} onChange={(e) => setStoragePassword(e.target.value)} /></label>
          <label>Invite code<input value={form.inviteCode} onChange={(e) => update('inviteCode', e.target.value)} /></label>
          <details>
            <summary>Server settings</summary>
            <label>API base URL<input value={form.apiBaseUrl} onChange={(e) => update('apiBaseUrl', e.target.value)} /></label>
            <label>WS URL<input value={form.wsUrl} onChange={(e) => update('wsUrl', e.target.value)} /></label>
          </details>
          <button>Register</button>
        </form>
      </section>
      <ApiResultBox value={result} error={error} />
    </div>
  );
}
