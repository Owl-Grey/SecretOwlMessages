export default function Layout({ children, page, setPage, profile }) {
  if (page === 'chat') return children;

  const tabs = [
    ['login', 'Login'],
    ['register', 'Register'],
    ['chat', 'Chat'],
    ['settings', 'Settings'],
    ['debug', 'Debug']
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Emergency Chat</h1>
          <p>{profile?.username ? `Signed in as ${profile.username}` : 'Private messenger client'}</p>
        </div>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
