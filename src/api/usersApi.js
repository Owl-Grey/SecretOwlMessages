import { apiRequest } from './client.js';

export function findUserByUsername(username) {
  return apiRequest(`/api/users/by-username/${encodeURIComponent(username)}`);
}

export function getKeys(userId) {
  return apiRequest(`/api/keys/${encodeURIComponent(userId)}`);
}

export function getMyDevices() {
  return apiRequest('/api/devices/my');
}

export function registerDevice(body, token, baseUrl) {
  return apiRequest('/api/devices/register', { method: 'POST', body, token, baseUrl });
}
