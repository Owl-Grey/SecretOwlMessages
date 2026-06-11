import { useState } from 'react';
import { findUserByUsername } from '../api/usersApi.js';
import { addContact } from '../db/localMessages.js';

export default function ContactSearch({ onAdded, onResult }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const user = await findUserByUsername(username.trim());
      const contact = await addContact({ userId: user.id, username: user.username });
      onResult?.(user);
      onAdded?.(contact);
      setUsername('');
    } catch (error) {
      onResult?.({ error: error.data || error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-form">
      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Add contact by username" />
      <button onClick={add} disabled={busy || !username.trim()}>Add</button>
    </div>
  );
}
