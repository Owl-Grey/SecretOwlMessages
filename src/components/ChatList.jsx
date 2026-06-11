import { formatTime } from '../utils/time.js';

export default function ChatList({ chats, selectedId, onSelect }) {
  return (
    <div className="chat-list">
      {chats.length === 0 && <p className="empty-state">No chats</p>}
      {chats.map((chat) => (
        <button
          key={chat.id}
          className={selectedId === chat.id ? 'selected' : ''}
          onClick={() => onSelect(chat)}
        >
          <span className="chat-avatar">{initials(chat.displayName)}</span>
          <span className="chat-meta">
            <strong>{chat.displayName}</strong>
            <small>{formatTime(chat.updatedAt)}</small>
          </span>
          {chat.unreadCount > 0 && <span className="unread-badge">{chat.unreadCount}</span>}
        </button>
      ))}
    </div>
  );
}

function initials(value = '') {
  const clean = value.trim();
  return (clean[0] || 'E').toUpperCase();
}
