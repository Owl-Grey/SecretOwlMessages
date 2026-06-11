import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { formatTime } from '../utils/time.js';

export default function ServerStatus() {
  const [status, setStatus] = useState('checking');
  const [time, setTime] = useState(null);

  async function check() {
    setStatus('checking');
    try {
      const result = await apiRequest('/api/health', { token: '' });
      setStatus(result.ok ? 'online' : 'error');
      setTime(result.time);
    } catch {
      setStatus('offline');
      setTime(null);
    }
  }

  useEffect(() => {
    check();
  }, []);

  return (
    <div className={`server-status ${status}`}>
      <span>{status}</span>
      <small>{time ? formatTime(time) : 'no response'}</small>
      <button onClick={check}>Check</button>
    </div>
  );
}
