import { getProfile } from '../db/localProfile.js';

const envBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';

export async function getApiBaseUrl() {
  const profile = await getProfile();
  return profile?.apiBaseUrl || envBaseUrl;
}

export async function getAccessToken() {
  const profile = await getProfile();
  return profile?.accessToken || '';
}

export async function apiRequest(path, options = {}) {
  const baseUrl = options.baseUrl || await getApiBaseUrl();
  const token = options.token ?? await getAccessToken();
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = data?.error?.message || response.statusText || 'API request failed';
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}
