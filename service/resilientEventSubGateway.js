'use strict';

const { EventEmitter } = require('events');

const DEFAULT_EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const CHAT_MESSAGE_TYPE = 'channel.chat.message';
const CHAT_MESSAGE_VERSION = '1';

class ResilientEventSubGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.tokenManager) throw new Error('ResilientEventSubGateway requires tokenManager.');
    if (!options.helixApi) throw new Error('ResilientEventSubGateway requires helixApi.');
    if (!options.webSocketFactory) throw new Error('ResilientEventSubGateway requires webSocketFactory.');

    this.tokenManager = options.tokenManager;
    this.helixApi = options.helixApi;
    this.broadcasterUserId = options.broadcasterUserId;
    this.senderUserId = options.senderUserId;
    this.webSocketFactory = options.webSocketFactory;
    this.eventSubWsUrl = options.eventSubWsUrl || DEFAULT_EVENTSUB_WS_URL;
    this.logger = options.logger || console;
    this.reconnectMinMs = options.reconnectMinMs || 1000;
    this.reconnectMaxMs = options.reconnectMaxMs || 60 * 1000;
    this.keepaliveGraceMs = options.keepaliveGraceMs || 5000;
    this.setTimeoutFn = options.setTimeoutFn || setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn || clearTimeout;

    this.socket = undefined;
    this.sessionId = undefined;
    this.connected = false;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = undefined;
    this.keepaliveTimer = undefined;
    this.keepaliveTimeoutMs = undefined;
    this.expectedClosures = new WeakSet();
    this.seenMessageIds = new Set();
  }

  async connect(url = this.eventSubWsUrl) {
    this.stopped = false;
    this.clearReconnectTimer();
    return this.openSocket(url);
  }

  async disconnect() {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearKeepaliveTimer();
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    this.sessionId = undefined;
    if (socket && socket.close) {
      this.expectedClosures.add(socket);
      socket.close();
    }
  }

  async ensureChatMessageSubscription() {
    if (!this.sessionId) throw new Error('EventSub welcome must be received before subscriptions can be created.');
    if (!this.broadcasterUserId || !this.senderUserId) {
      throw new Error('Chat subscription requires broadcasterUserId and senderUserId.');
    }

    await this.tokenManager.validate('user');
    const result = await this.helixApi.createEventSubSubscription({
      type: CHAT_MESSAGE_TYPE,
      version: CHAT_MESSAGE_VERSION,
      condition: {
        broadcaster_user_id: this.broadcasterUserId,
        user_id: this.senderUserId
      },
      transport: {
        method: 'websocket',
        session_id: this.sessionId
      }
    });
    this.emit('subscribed', result);
    return result;
  }

  openSocket(url, { resetReconnectAttempt = true } = {}) {
    const socket = this.webSocketFactory(url);

    return new Promise((resolve, reject) => {
      let welcomed = false;
      let settled = false;

      const settleReject = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const onMessage = data => {
        let envelope;
        try {
          envelope = this.parseMessage(data);
        } catch (error) {
          this.emit('error', error);
          return;
        }

        const type = envelope.metadata && envelope.metadata.message_type;
        if (type === 'session_welcome') {
          welcomed = true;
          const previousSocket = this.socket;
          this.socket = socket;
          this.connected = true;
          this.sessionId = envelope.payload && envelope.payload.session && envelope.payload.session.id;
          if (resetReconnectAttempt) this.reconnectAttempt = 0;
          this.updateKeepaliveTimeout(envelope);
          this.emit('session_welcome', envelope);

          if (previousSocket && previousSocket !== socket && previousSocket.close) {
            this.expectedClosures.add(previousSocket);
            previousSocket.close();
          }
          if (!settled) {
            settled = true;
            resolve(this.sessionId);
          }
          return;
        }

        if (socket !== this.socket) return;
        this.resetKeepaliveTimer();
        this.handleEnvelope(envelope);
      };
      const onClose = () => {
        const expected = this.expectedClosures.has(socket);
        this.expectedClosures.delete(socket);
        if (!welcomed) settleReject(new Error('Twitch EventSub WebSocket closed before session_welcome.'));
        if (socket !== this.socket) return;

        this.socket = undefined;
        this.connected = false;
        this.sessionId = undefined;
        this.clearKeepaliveTimer();
        this.emit('disconnected');
        if (!expected && !this.stopped) this.scheduleReconnect();
      };
      const onError = error => {
        this.emit('error', error);
        if (!welcomed) settleReject(error);
      };

      if (socket.on) {
        socket.on('message', onMessage);
        socket.on('close', onClose);
        socket.on('error', onError);
      } else {
        socket.onmessage = event => onMessage(event.data);
        socket.onclose = onClose;
        socket.onerror = onError;
      }
    });
  }

  parseMessage(data) {
    if (Buffer.isBuffer(data)) return JSON.parse(data.toString('utf8'));
    if (typeof data === 'string') return JSON.parse(data);
    return data;
  }

  handleEnvelope(envelope) {
    const type = envelope.metadata && envelope.metadata.message_type;

    if (type === 'session_keepalive') {
      this.emit('session_keepalive', envelope);
      return;
    }
    if (type === 'session_reconnect') {
      const reconnectUrl = envelope.payload && envelope.payload.session && envelope.payload.session.reconnect_url;
      this.emit('session_reconnect', reconnectUrl, envelope);
      this.openSocket(reconnectUrl).catch(error => {
        this.emit('error', error);
        if (!this.connected && !this.stopped) this.scheduleReconnect();
      });
      return;
    }
    if (type === 'revocation') {
      const subscription = envelope.payload && envelope.payload.subscription;
      this.emit('revocation', subscription, envelope);
      if (subscription && subscription.status === 'authorization_revoked') {
        this.recoverSubscription();
      }
      return;
    }
    if (type === 'notification') {
      this.handleNotification(envelope);
      return;
    }
    this.emit('event', envelope);
  }

  handleNotification(envelope) {
    const id = envelope.metadata && envelope.metadata.message_id;
    if (id && this.seenMessageIds.has(id)) return false;
    if (id) this.seenMessageIds.add(id);

    const payload = envelope.payload || envelope;
    if (payload.subscription && payload.subscription.type === CHAT_MESSAGE_TYPE) {
      this.emit('chatMessage', payload);
      return true;
    }
    this.emit('event', payload);
    return true;
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * Math.pow(2, this.reconnectAttempt)
    );
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { delay, attempt: this.reconnectAttempt });
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = undefined;
      this.recoverConnection();
    }, delay);
  }

  async recoverConnection() {
    try {
      await this.openSocket(this.eventSubWsUrl, { resetReconnectAttempt: false });
      await this.ensureChatMessageSubscription();
      this.reconnectAttempt = 0;
    } catch (error) {
      this.emit('error', error);
      const socket = this.socket;
      if (socket && socket.close) {
        this.expectedClosures.add(socket);
        socket.close();
      }
      this.scheduleReconnect();
    }
  }

  async recoverSubscription() {
    try {
      await this.ensureChatMessageSubscription();
    } catch (error) {
      this.emit('error', error);
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  updateKeepaliveTimeout(envelope) {
    const seconds = Number(
      envelope.payload && envelope.payload.session && envelope.payload.session.keepalive_timeout_seconds
    );
    this.keepaliveTimeoutMs = Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000 + this.keepaliveGraceMs
      : undefined;
    this.resetKeepaliveTimer();
  }

  resetKeepaliveTimer() {
    this.clearKeepaliveTimer();
    if (!this.keepaliveTimeoutMs || !this.socket) return;
    const socket = this.socket;
    this.keepaliveTimer = this.setTimeoutFn(() => {
      this.keepaliveTimer = undefined;
      if (socket !== this.socket) return;
      this.emit('error', new Error('Twitch EventSub keepalive timed out; reconnecting.'));
      if (socket.terminate) socket.terminate();
      else if (socket.close) socket.close();
    }, this.keepaliveTimeoutMs);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  clearKeepaliveTimer() {
    if (!this.keepaliveTimer) return;
    this.clearTimeoutFn(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }
}

module.exports = ResilientEventSubGateway;
module.exports.CHAT_MESSAGE_TYPE = CHAT_MESSAGE_TYPE;
