import { db } from './db.js';

const PROFILE_ID = 'current';

export async function getProfile() {
  return db.profiles.get(PROFILE_ID);
}

export async function saveProfile(profile) {
  const current = await getProfile();
  const next = {
    ...current,
    ...profile,
    id: PROFILE_ID,
    createdAt: current?.createdAt || Date.now()
  };
  await db.profiles.put(next);
  return next;
}

export async function saveSetting(key, value) {
  await db.settings.put({ key, value });
}

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value;
}

export async function getJsonSetting(key, fallback) {
  const value = await getSetting(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function saveJsonSetting(key, value) {
  await saveSetting(key, JSON.stringify(value));
}
