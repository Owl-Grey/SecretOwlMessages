export function createChatSocket(wsUrl, token, handlers = {}) {
  const separator = wsUrl.includes('?') ? '&' : '?';
  const socket = new WebSocket(`${wsUrl}${separator}token=${encodeURIComponent(token)}`);

  socket.addEventListener('open', () => handlers.onStatus?.('connected'));
  socket.addEventListener('close', () => handlers.onStatus?.('disconnected'));
  socket.addEventListener('error', () => handlers.onStatus?.('error'));
  socket.addEventListener('message', (event) => {
    try {
      handlers.onEvent?.(JSON.parse(event.data));
    } catch {
      handlers.onEvent?.({ type: 'raw', data: event.data });
    }
  });

  return socket;
}
