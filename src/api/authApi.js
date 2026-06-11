import { apiRequest } from './client.js';

export function register(body, baseUrl) {
  return apiRequest('/api/auth/register', { method: 'POST', body, baseUrl, token: '' });
}

export function login(body, baseUrl) {
  return apiRequest('/api/auth/login', { method: 'POST', body, baseUrl, token: '' });
}

export function me() {
  return apiRequest('/api/auth/me');
}
