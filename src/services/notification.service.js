import { getSetting, saveSetting } from '../db/localProfile.js';

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

export function canShowNotifications() {
  return 'Notification' in window && Notification.permission === 'granted';
}

export async function getNotificationSettings() {
  return {
    inApp: (await getSetting('notifyInApp')) !== 'false',
    browser: (await getSetting('notifyBrowser')) === 'true',
    hideText: (await getSetting('notifyHideText')) !== 'false'
  };
}

export async function saveNotificationSettings(settings) {
  await saveSetting('notifyInApp', String(Boolean(settings.inApp)));
  await saveSetting('notifyBrowser', String(Boolean(settings.browser)));
  await saveSetting('notifyHideText', String(Boolean(settings.hideText)));
}

export function shouldNotifyForMessage(message, activeChatId) {
  if (!message || message.direction !== 'incoming') return false;
  if (message.chatId === activeChatId && document.visibilityState === 'visible' && document.hasFocus()) {
    return false;
  }
  return true;
}

export async function showNewMessageNotification({ title = 'Emergency Chat', body = 'New message', chatId, onClick }) {
  const settings = await getNotificationSettings();
  if (settings.browser && canShowNotifications()) {
    const notification = new Notification(title, {
      body: settings.hideText ? 'New message' : body,
      icon: './icons/icon-192.svg',
      tag: chatId || 'emergency-chat'
    });
    notification.onclick = () => {
      window.focus();
      onClick?.(chatId);
      notification.close();
    };
  }
}
