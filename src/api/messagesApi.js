import { apiRequest } from './client.js';

export function sendMessage(body) {
  return apiRequest('/api/messages/send', { method: 'POST', body });
}

export function pullMessages(limit = 100) {
  return apiRequest(`/api/messages/pull?limit=${encodeURIComponent(limit)}`);
}

export function ackMessages(messageIds) {
  return apiRequest('/api/messages/ack', { method: 'POST', body: { messageIds } });
}
