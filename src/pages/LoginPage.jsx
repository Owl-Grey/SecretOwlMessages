import { useEffect, useState } from 'react';
import { login } from '../api/authApi.js';
import ApiResultBox from '../components/ApiResultBox.jsx';
import { getProfile, getSetting, saveProfile, saveSetting } from '../db/localProfile.js';
import { registerDevice } from '../api/usersApi.js';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  exportPublicKeyJwk,
  generateDeviceKeyPair,
  keyFingerprint
} from '../crypto/crypto.js';

const envApi = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';
const envWs = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:3000/ws';

export default function LoginPage({ setProfile, storagePassword, setStoragePassword, go }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(envApi);
  const [wsUrl, setWsUrl] = useState(envWs);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('Browser');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getSetting('apiBaseUrl'), getSetting('wsUrl')]).then(([api, ws]) => {
      if (api) setApiBaseUrl(api);
      if (ws) setWsUrl(ws);
    });
  }, []);

  async function ensureDevice(savedProfile, accessToken) {
    if (savedProfile?.encryptedPrivateKey && savedProfile?.deviceId) {
      await decryptPrivateKey(savedProfile.encryptedPrivateKey, storagePassword);
      return {
        deviceId: savedProfile.deviceId,
        encryptedPrivateKey: savedProfile.encryptedPrivateKey,
        publicKey: savedProfile.publicKey,
        salt: savedProfile.salt
      };
    }

    const keyPair = await generateDeviceKeyPair();
    const publicKey = await exportPublicKeyJwk(keyPair.publicKey);
    const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, storagePassword);
    const fingerprint = await keyFingerprint(publicKey);
    const device = await registerDevice({
      deviceName,
      devicePublicKey: JSON.stringify(publicKey),
      keyFingerprint: fingerprint
    }, accessToken, apiBaseUrl);

    return {
      deviceId: device.id,
      encryptedPrivateKey: JSON.stringify(encryptedPrivateKey),
      publicKey: JSON.stringify(publicKey),
      salt: encryptedPrivateKey.salt
    };
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      if (!storagePassword) throw new Error('Storage password is required');
      const response = await login({ username, password }, apiBaseUrl);
      const previous = await getProfile();
      const deviceData = await ensureDevice(previous?.username === response.user.username ? previous : null, response.accessToken);
      const saved = await saveProfile({
        username: response.user.username,
        userId: response.user.id,
        accessToken: response.accessToken,
        apiBaseUrl,
        wsUrl,
        ...deviceData
      });
      await saveSetting('apiBaseUrl', apiBaseUrl);
      await saveSetting('wsUrl', wsUrl);
      setProfile(saved);
      setResult({ user: response.user, deviceId: saved.deviceId });
      go('chat');
    } catch (err) {
      setError(err);
      setResult(err.data);
    }
  }

  async function useSavedProfile() {
    setError(null);
    try {
      if (!storagePassword) throw new Error('Storage password is required');
      const saved = await getProfile();
      if (!saved) throw new Error('No saved profile');
      await decryptPrivateKey(saved.encryptedPrivateKey, storagePassword);
      setProfile(saved);
      setApiBaseUrl(saved.apiBaseUrl || envApi);
      setWsUrl(saved.wsUrl || envWs);
      go('chat');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <h2>Login</h2>
        <form onSubmit={submit} className="stack">
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>Account password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>Storage password<input type="password" value={storagePassword} onChange={(e) => setStoragePassword(e.target.value)} /></label>
          <details>
            <summary>Server settings</summary>
            <label>API base URL<input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} /></label>
            <label>WS URL<input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} /></label>
            <label>New device name<input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} /></label>
          </details>
          <div className="actions">
            <button>Login</button>
            <button type="button" onClick={useSavedProfile}>Use saved profile</button>
          </div>
        </form>
      </section>
      <ApiResultBox value={result} error={error} />
    </div>
  );
}
