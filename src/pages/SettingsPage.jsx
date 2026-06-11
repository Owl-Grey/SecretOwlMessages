import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { wipeLocalData } from '../db/db.js';
import { getSetting, saveProfile, saveSetting } from '../db/localProfile.js';
import { getMyDevices } from '../api/usersApi.js';
import {
  checkIncomingSyncPackages,
  createHistorySyncPackages,
  importHistorySyncPackage
} from '../services/deviceSync.service.js';
import {
  requestNotificationPermission,
  saveNotificationSettings
} from '../services/notification.service.js';

export default function SettingsPage({ profile, setProfile, setStoragePassword, localPrivateKey, go }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(profile?.apiBaseUrl || '');
  const [wsUrl, setWsUrl] = useState(profile?.wsUrl || '');
  const [serverStatus, setServerStatus] = useState('');
  const [devices, setDevices] = useState([]);
  const [syncPackages, setSyncPackages] = useState([]);
  const [syncStatus, setSyncStatus] = useState('');
  const [notifyStatus, setNotifyStatus] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [notifySettings, setNotifySettings] = useState({ inApp: true, browser: false, hideText: true });

  useEffect(() => {
    getMyDevices().then((result) => setDevices(result.devices || [])).catch(() => {});
    Promise.all([
      getSetting('notifyInApp'),
      getSetting('notifyBrowser'),
      getSetting('notifyHideText')
    ]).then(([inApp, browser, hideText]) => {
      setNotifySettings({
        inApp: inApp !== 'false',
        browser: browser === 'true',
        hideText: hideText !== 'false'
      });
    });
  }, []);

  async function saveServer() {
    const saved = await saveProfile({ apiBaseUrl, wsUrl });
    await saveSetting('apiBaseUrl', apiBaseUrl);
    await saveSetting('wsUrl', wsUrl);
    setProfile(saved);
    setServerStatus('Saved');
  }

  async function checkServer() {
    setServerStatus('Checking...');
    try {
      const result = await apiRequest('/api/health', { token: '', baseUrl: apiBaseUrl });
      setServerStatus(result.ok ? 'Connection is OK' : 'Server responded with an error');
    } catch (error) {
      setServerStatus(error.message || 'Connection failed');
    }
  }

  function lockStorage() {
    setStoragePassword('');
    go('chat');
  }

  async function createSyncPackages() {
    if (!localPrivateKey) {
      setSyncStatus('Unlock local storage before creating a sync package.');
      return;
    }
    setSyncStatus('Creating sync package...');
    try {
      const result = await createHistorySyncPackages({ profile, localPrivateKey });
      setSyncStatus(`Sync package created for ${result.packages.length} device(s). Open Emergency Chat on another device and press Sync. Expires in 10 minutes.`);
    } catch (error) {
      setSyncStatus(error.message || 'Failed to create sync package');
    }
  }

  async function checkPackages() {
    setSyncStatus('Checking sync packages...');
    try {
      const result = await checkIncomingSyncPackages(profile);
      setSyncPackages(result.packages || []);
      setSyncStatus(result.packages?.length ? 'Sync package available.' : 'No sync packages available.');
    } catch (error) {
      setSyncStatus(error.message || 'Failed to check sync packages');
    }
  }

  async function importPackage(packageId) {
    if (!localPrivateKey) {
      setSyncStatus('Unlock local storage before importing.');
      return;
    }
    setSyncStatus('Importing sync package...');
    try {
      const result = await importHistorySyncPackage({ profile, localPrivateKey, packageId });
      setSyncStatus(`Sync complete. Imported: ${result.contacts} contacts, ${result.chats} chats, ${result.messages} messages. Skipped: ${result.skipped}.`);
      await checkPackages();
    } catch (error) {
      setSyncStatus(error.message || 'Sync import failed');
    }
  }

  async function updateNotify(next) {
    setNotifySettings(next);
    await saveNotificationSettings(next);
  }

  async function allowNotifications() {
    const status = await requestNotificationPermission();
    setNotifyStatus(status);
    if (status === 'granted') {
      await updateNotify({ ...notifySettings, browser: true });
    }
  }

  return (
    <div className="settings-user-screen">
      <section className="settings-card">
        <div className="settings-title-row">
          <h1>Settings</h1>
          <button onClick={() => go('chat')}>Back</button>
        </div>

        <section className="settings-section">
          <h2>Profile</h2>
          <div className="profile-line">
            <div className="profile-avatar">{initials(profile?.username)}</div>
            <div>
              <strong>{profile?.username || 'Not signed in'}</strong>
              <p>Emergency Chat account</p>
            </div>
          </div>
          <button onClick={() => go('login')}>Log out</button>
        </section>

        <section className="settings-section">
          <h2>Security</h2>
          <p>Messages are stored on this device only as encrypted payloads.</p>
          <p>Files and images are stored on the server only temporarily as encrypted blobs.</p>
          <div className="actions">
            <button onClick={lockStorage}>Lock storage</button>
            <button className="danger" onClick={wipeLocalData}>Erase data on this device</button>
          </div>
        </section>

        <section className="settings-section">
          <h2>Device sync</h2>
          <p>Current device: {currentDeviceName(devices, profile?.deviceId)}</p>
          <div className="actions">
            <button onClick={createSyncPackages}>Create sync package</button>
            <button onClick={checkPackages}>Sync now</button>
          </div>
          {syncPackages.map((item) => (
            <div className="sync-package-row" key={item.id}>
              <span>Package from {shortId(item.fromDeviceId)}. Expires in {minutesLeft(item.expiresAt)} min.</span>
              <button onClick={() => importPackage(item.id)}>Import</button>
            </div>
          ))}
          {syncStatus && <p className="settings-status">{syncStatus}</p>}
        </section>

        <section className="settings-section">
          <h2>Notifications</h2>
          <p>Permission: {notifyStatus}</p>
          <div className="actions wrap">
            <button onClick={allowNotifications}>Allow notifications</button>
            <label className="toggle-line">
              <input type="checkbox" checked={notifySettings.inApp} onChange={(e) => updateNotify({ ...notifySettings, inApp: e.target.checked })} />
              In-app notifications
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={notifySettings.browser} onChange={(e) => updateNotify({ ...notifySettings, browser: e.target.checked })} />
              Browser notifications
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={notifySettings.hideText} onChange={(e) => updateNotify({ ...notifySettings, hideText: e.target.checked })} />
              Hide message text
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h2>Server</h2>
          <details>
            <summary>Advanced server settings</summary>
            <div className="stack">
              <label>API URL<input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} /></label>
              <label>WS URL<input value={wsUrl} onChange={(event) => setWsUrl(event.target.value)} /></label>
              <div className="actions">
                <button onClick={saveServer}>Save server</button>
                <button onClick={checkServer}>Check connection</button>
              </div>
              {serverStatus && <p className="settings-status">{serverStatus}</p>}
            </div>
          </details>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <p>Emergency Chat frontend 0.1.0</p>
          <p>{profile?.encryptedPrivateKey ? 'Device encryption is enabled.' : 'Device encryption is not configured.'}</p>
        </section>

        <button className="debug-link subtle" onClick={() => go('debug')}>Developer / Debug</button>
      </section>
    </div>
  );
}

function initials(value = '') {
  const clean = value.trim();
  return (clean[0] || 'E').toUpperCase();
}

function shortId(value = '') {
  return value ? `${value.slice(0, 8)}...` : 'unknown';
}

function currentDeviceName(devices, deviceId) {
  const device = devices.find((item) => item.id === deviceId);
  return device?.deviceName || shortId(deviceId);
}

function minutesLeft(expiresAt) {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
}
