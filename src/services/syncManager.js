import { ackMessages, pullMessages } from '../api/messagesApi.js';
import { createChatSocket } from '../api/websocket.js';
import { savePulledMessages } from '../db/localMessages.js';
import { getJsonSetting, saveJsonSetting } from '../db/localProfile.js';
import { nowMs } from '../utils/time.js';

const POLL_INTERVAL_MS = 10000;
const POLL_AFTER_WS_DOWN_MS = 3000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const PENDING_ACK_KEY = 'pendingAckMessageIds';

export class SyncManager {
  constructor({ profile, getActiveChatId, onUpdate, onStatus, onMessagesSaved }) {
    this.profile = profile;
    this.getActiveChatId = getActiveChatId;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.onMessagesSaved = onMessagesSaved;
    this.socket = null;
    this.started = false;
    this.pullRunning = false;
    this.pendingPullAfterCurrent = false;
    this.pollTimer = null;
    this.pollDelayTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.wsConnected = false;
  }

  startSync() {
    if (this.started) return;
    this.started = true;
    this.markConnectionStatus('Connecting');
    this.connectWebSocket();
    this.pullMessages('start');
    this.onFocus = () => this.pullMessages('focus');
    this.onVisibility = () => {
      if (document.visibilityState === 'visible') this.pullMessages('visible');
    };
    this.onOnline = () => {
      this.connectWebSocket();
      this.pullMessages('online');
    };
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedulePollingFallback();
  }

  stopSync() {
    this.started = false;
    this.wsConnected = false;
    if (this.socket) this.socket.close();
    this.socket = null;
    clearTimeout(this.pollDelayTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pollTimer);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  markConnectionStatus(status, error = '') {
    this.onStatus?.({ status, error, lastSyncAt: this.lastSyncAt || null });
  }

  connectWebSocket() {
    if (!this.started || this.socket || !this.profile?.accessToken || !this.profile?.wsUrl) return;
    if (navigator.onLine === false) {
      this.markConnectionStatus('Offline');
      return;
    }
    this.markConnectionStatus('Connecting');
    this.socket = createChatSocket(this.profile.wsUrl, this.profile.accessToken, {
      onStatus: (status) => {
        if (status === 'connected') {
          this.wsConnected = true;
          this.reconnectAttempt = 0;
          this.markConnectionStatus('Online');
          this.stopPolling();
          this.pullMessages('ws-open');
          return;
        }
        if (status === 'disconnected' || status === 'error') {
          this.wsConnected = false;
          this.socket = null;
          this.markConnectionStatus(status === 'error' ? 'Sync error' : 'Offline');
          this.schedulePollingFallback();
          this.reconnectWebSocket();
        }
      },
      onEvent: (event) => {
        if (event.type === 'message:new') this.pullMessages('ws-message');
      }
    });
  }

  reconnectWebSocket() {
    if (!this.started || this.socket || navigator.onLine === false) return;
    clearTimeout(this.reconnectTimer);
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
  }

  schedulePollingFallback() {
    clearTimeout(this.pollDelayTimer);
    this.pollDelayTimer = setTimeout(() => {
      if (!this.started || this.wsConnected) return;
      this.scheduleNextPoll();
    }, POLL_AFTER_WS_DOWN_MS);
  }

  scheduleNextPoll() {
    if (this.pollTimer || this.wsConnected) return;
    this.markConnectionStatus(navigator.onLine === false ? 'Offline' : 'Polling');
    this.pollTimer = setInterval(() => {
      if (navigator.onLine === false) {
        this.markConnectionStatus('Offline');
        return;
      }
      this.pullMessages('poll');
    }, POLL_INTERVAL_MS);
    this.pullMessages('poll-start');
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async pullMessages(_reason = 'manual') {
    if (!this.started || !this.profile?.userId) return;
    if (navigator.onLine === false) {
      this.markConnectionStatus('Offline');
      return;
    }
    if (this.pullRunning) {
      this.pendingPullAfterCurrent = true;
      return;
    }

    this.pullRunning = true;
    try {
      await this.flushPendingAcks();
      const response = await pullMessages(100);
      const pulled = response.messages || [];
      const savedMessages = await savePulledMessages(pulled, this.profile.userId, {
        activeChatId: this.getActiveChatId?.()
      });
      if (savedMessages.length > 0) {
        await this.onMessagesSaved?.(savedMessages);
      }
      if (pulled.length > 0) {
        await this.ackOrStore(pulled.map((message) => message.id));
      }
      this.lastSyncAt = nowMs();
      this.markConnectionStatus(this.wsConnected ? 'Online' : 'Polling');
      await this.onUpdate?.({ pulledCount: pulled.length, lastSyncAt: this.lastSyncAt });
    } catch (error) {
      this.markConnectionStatus('Sync error', error.message || 'Sync failed');
    } finally {
      this.pullRunning = false;
      if (this.pendingPullAfterCurrent) {
        this.pendingPullAfterCurrent = false;
        this.pullMessages('pending');
      }
    }
  }

  async ackOrStore(ids) {
    if (!ids.length) return;
    try {
      await ackMessages(ids);
    } catch {
      const pending = await getJsonSetting(PENDING_ACK_KEY, []);
      await saveJsonSetting(PENDING_ACK_KEY, Array.from(new Set([...pending, ...ids])));
    }
  }

  async flushPendingAcks() {
    const pending = await getJsonSetting(PENDING_ACK_KEY, []);
    if (!pending.length) return;
    try {
      await ackMessages(pending);
      await saveJsonSetting(PENDING_ACK_KEY, []);
    } catch {
      // Keep pending ids for the next sync attempt.
    }
  }
}
