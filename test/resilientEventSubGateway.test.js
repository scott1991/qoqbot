'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const test = require('node:test');
const ResilientEventSubGateway = require('../service/resilientEventSubGateway');

class FakeSocket extends EventEmitter {
  close() { this.emit('close'); }
  terminate() { this.emit('close'); }
}

function welcome(socket, id, keepaliveTimeoutSeconds = 10) {
  socket.emit('message', JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: {
      session: {
        id,
        keepalive_timeout_seconds: keepaliveTimeoutSeconds
      }
    }
  }));
}

function createGateway(overrides = {}) {
  const sockets = [];
  const subscriptions = [];
  const gateway = new ResilientEventSubGateway({
    tokenManager: { validate: async () => ({ scopes: ['user:read:chat'] }) },
    helixApi: {
      createEventSubSubscription: async subscription => {
        subscriptions.push(subscription);
        return { data: [subscription] };
      }
    },
    broadcasterUserId: 'broadcaster-1',
    senderUserId: 'bot-1',
    webSocketFactory: url => {
      const socket = new FakeSocket();
      socket.url = url;
      sockets.push(socket);
      return socket;
    },
    reconnectMinMs: 1,
    reconnectMaxMs: 2,
    ...overrides
  });
  gateway.on('error', () => {});
  return { gateway, sockets, subscriptions };
}

test('unexpected close reconnects and recreates the chat subscription', async () => {
  const { gateway, sockets, subscriptions } = createGateway();
  const connected = gateway.connect();
  welcome(sockets[0], 'session-1');
  await connected;
  await gateway.ensureChatMessageSubscription();

  const reconnecting = new Promise(resolve => gateway.once('reconnecting', resolve));
  sockets[0].emit('close');
  await reconnecting;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sockets.length, 2);

  const subscribed = new Promise(resolve => gateway.once('subscribed', resolve));
  welcome(sockets[1], 'session-2');
  await subscribed;

  assert.equal(subscriptions.length, 2);
  assert.equal(subscriptions[1].transport.session_id, 'session-2');
  await gateway.disconnect();
});

test('Twitch reconnect URL transfers the existing subscription without duplicating it', async () => {
  const { gateway, sockets, subscriptions } = createGateway();
  const connected = gateway.connect();
  welcome(sockets[0], 'session-1');
  await connected;
  await gateway.ensureChatMessageSubscription();

  sockets[0].emit('message', JSON.stringify({
    metadata: { message_type: 'session_reconnect' },
    payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=1' } }
  }));
  assert.equal(sockets.length, 2);
  welcome(sockets[1], 'session-2');

  assert.equal(sockets[1].url, 'wss://eventsub.wss.twitch.tv/ws?reconnect=1');
  assert.equal(subscriptions.length, 1);
  assert.equal(gateway.connected, true);
  await gateway.disconnect();
});

test('keepalive timeout terminates a stale socket and schedules recovery', async () => {
  const timers = [];
  const { gateway, sockets } = createGateway({
    keepaliveGraceMs: 1,
    setTimeoutFn: callback => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: timer => { timer.cleared = true; }
  });
  const connected = gateway.connect();
  welcome(sockets[0], 'session-1', 1);
  await connected;

  const keepaliveTimer = timers.find(timer => !timer.cleared);
  keepaliveTimer.cleared = true;
  keepaliveTimer.callback();

  assert.equal(gateway.connected, false);
  assert.equal(timers.filter(timer => !timer.cleared).length, 1);
  await gateway.disconnect();
});
