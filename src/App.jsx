import { useEffect, useState } from 'react';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ApiDebugPage from './pages/ApiDebugPage.jsx';
import { getProfile } from './db/localProfile.js';

export default function App() {
  const [page, setPage] = useState('login');
  const [profile, setProfile] = useState(null);
  const [storagePassword, setStoragePassword] = useState('');
  const [localPrivateKey, setLocalPrivateKey] = useState(null);

  async function refreshProfile() {
    const saved = await getProfile();
    setProfile(saved || null);
    if (saved && page === 'login') setPage('chat');
  }

  useEffect(() => {
    refreshProfile().catch(() => {});
  }, []);

  const pageProps = {
    profile,
    setProfile,
    storagePassword,
    setStoragePassword,
    localPrivateKey,
    setLocalPrivateKey,
    refreshProfile,
    go: setPage
  };

  return (
    <Layout page={page} setPage={setPage} profile={profile}>
      {page === 'login' && <LoginPage {...pageProps} />}
      {page === 'register' && <RegisterPage {...pageProps} />}
      {page === 'chat' && <ChatPage {...pageProps} />}
      {page === 'settings' && <SettingsPage {...pageProps} />}
      {page === 'debug' && <ApiDebugPage {...pageProps} />}
    </Layout>
  );
}
