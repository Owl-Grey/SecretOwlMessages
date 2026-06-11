import { apiRequest } from './client.js';

export function createSyncPackage(body) {
  return apiRequest('/api/sync/packages', { method: 'POST', body });
}

export function listSyncPackages(deviceId) {
  return apiRequest(`/api/sync/packages/my?deviceId=${encodeURIComponent(deviceId)}`);
}

export function getSyncPackage(packageId, deviceId) {
  return apiRequest(`/api/sync/packages/${encodeURIComponent(packageId)}?deviceId=${encodeURIComponent(deviceId)}`);
}

export function ackSyncPackage(packageId, deviceId) {
  return apiRequest(`/api/sync/packages/${encodeURIComponent(packageId)}/ack`, {
    method: 'POST',
    body: { deviceId }
  });
}

export function deleteSyncPackage(packageId) {
  return apiRequest(`/api/sync/packages/${encodeURIComponent(packageId)}`, { method: 'DELETE' });
}
