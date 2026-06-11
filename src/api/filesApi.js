import { apiRequest, getApiBaseUrl, getAccessToken } from './client.js';

export function uploadEncryptedFile({ encryptedBlob, recipientUserId, originalNameEncrypted = '', mimeType = 'application/octet-stream' }) {
  const formData = new FormData();
  formData.append('recipientUserId', recipientUserId);
  if (originalNameEncrypted) formData.append('originalNameEncrypted', originalNameEncrypted);
  formData.append('mimeType', mimeType);
  formData.append('file', encryptedBlob, 'encrypted.bin');
  return apiRequest('/api/files/upload', { method: 'POST', body: formData });
}

export async function downloadEncryptedFile(fileId) {
  const baseUrl = await getApiBaseUrl();
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl}/api/files/${encodeURIComponent(fileId)}/download`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const message = response.status === 404 || response.status === 410
      ? 'File is no longer available on the server.'
      : 'File download failed.';
    throw new Error(message);
  }
  return response.blob();
}

export function deleteFile(fileId) {
  return apiRequest(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}
