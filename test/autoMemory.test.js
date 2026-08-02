'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AIChatResponder = require('../service/aiChatResponder');
const {
  normalizeAutoCaptureConfig,
  parseAIEnvelope,
  validateCandidate
} = require('../service/autoMemory');

function config(overrides = {}) {
  return normalizeAutoCaptureConfig({ enabled: true, ...overrides });
}

function humanMessage(overrides = {}) {
  return {
    evidenceId: 7,
    username: 'owner',
    userId: '10',
    isBroadcaster: true,
    text: '我的項鍊是自己做的',
    ...overrides
  };
}

test('structured response isolates reply and candidate while legacy text remains compatible', () => {
  const parsed = parseAIEnvelope(JSON.stringify({
    reply: '原來是自己做的',
    memory_candidate: { fact: '台主的項鍊是自己製作的', kind: 'stable_fact', confidence: 0.92, evidence: [7] }
  }));
  assert.equal(parsed.reply, '原來是自己做的');
  assert.equal(parsed.memoryCandidate.fact, '台主的項鍊是自己製作的');
  assert.equal(parseAIEnvelope('笑死').reply, '笑死');
  assert.deepEqual(parseAIEnvelope('{"reply":"會洩漏"'), {
    reply: '', memoryCandidate: null, format: 'invalid_json'
  });
});

test('candidate validation requires recent human evidence and rejects unsafe or temporary claims', () => {
  const valid = { fact: '台主的項鍊是自己製作的', kind: 'stable_fact', confidence: 0.92, evidence: [7] };
  assert.equal(validateCandidate(valid, [humanMessage()], config()).valid, true);
  assert.equal(validateCandidate(valid, [humanMessage({ isSelf: true })], config()).reason, 'invalid-evidence');
  assert.equal(validateCandidate({ ...valid, evidence: [99] }, [humanMessage()], config()).reason, 'invalid-evidence');
  assert.equal(validateCandidate({ ...valid, fact: '台主今天穿紅色' }, [humanMessage()], config()).reason, 'temporary-content');
  assert.equal(validateCandidate({ ...valid, fact: '台主的電話是 0912345678' }, [humanMessage()], config()).reason, 'sensitive-content');
  assert.equal(validateCandidate({ ...valid, fact: '聯絡方式是 test@example.com' }, [humanMessage()], config()).reason, 'sensitive-content');
  assert.equal(validateCandidate({ ...valid, fact: '台主喜歡紅茶嗎？' }, [humanMessage()], config()).reason, 'non-factual-content');
});

test('recent human chat receives stable evidence numbers while bot output receives none', () => {
  const responder = new AIChatResponder({
    config: { enabled: true, max_context_messages: 2 }
  });
  const state = responder.getState('channel');
  responder.addContextMessage(state, { username: 'first', userId: '1', text: 'one' });
  responder.addContextMessage(state, { username: 'bot', userId: '2', text: 'tool output', isSelf: true });
  responder.addContextMessage(state, { username: 'second', userId: '3', text: 'two' });

  assert.deepEqual(state.messages.map(message => message.evidenceId), [undefined, 2]);
  const lines = responder.buildContextLines(state.messages);
  assert.doesNotMatch(lines[0], /evidence/);
  assert.match(lines[1], /^\[evidence 2\]/);
});

test('only broadcaster stable facts save and exact or semantic matches deduplicate', async () => {
  const calls = [];
  const memoryClient = {
    isEnabled: () => true,
    recall: async (channelId, fact) => {
      calls.push({ method: 'recall', channelId, fact });
      return { memories: [] };
    },
    remember: async (channelId, fact) => {
      calls.push({ method: 'remember', channelId, fact });
      return { id: 'AB12CD34' };
    }
  };
  const responder = new AIChatResponder({
    config: { enabled: true },
    memoryClient,
    autoCaptureConfig: config()
  });
  const candidate = { fact: '台主的項鍊是自己製作的', kind: 'stable_fact', confidence: 0.92, evidence: [7] };

  assert.deepEqual(await responder.processMemoryCandidate({ channelId: '20', messages: [humanMessage()], candidate }), {
    decision: 'saved', id: 'AB12CD34'
  });
  assert.equal(calls.filter(call => call.method === 'remember').length, 1);

  const viewer = await responder.processMemoryCandidate({
    channelId: '20', messages: [humanMessage({ isBroadcaster: false })], candidate
  });
  assert.equal(viewer.reason, 'viewer-source');

  memoryClient.recall = async () => ({ memories: [{ id: 'OLD12345', content: '不同措辭', score: 0.91 }] });
  const duplicate = await responder.processMemoryCandidate({ channelId: '20', messages: [humanMessage()], candidate });
  assert.deepEqual(duplicate, { decision: 'duplicate', matchedId: 'OLD12345' });
  assert.equal(calls.filter(call => call.method === 'remember').length, 1);
});

test('filtered reply never schedules a memory candidate and malformed JSON never reaches chat', async () => {
  const responder = new AIChatResponder({
    config: { enabled: true, min_messages: 1, cooldown_ms: 0 },
    joinedChannels: ['channel'],
    autoCaptureConfig: config()
  });
  let processed = false;
  responder.processMemoryCandidate = async () => { processed = true; };
  responder.sendReplyRequest = async () => ({
    reply: 'filtered',
    memoryCandidate: { fact: '不該儲存', kind: 'stable_fact', confidence: 1, evidence: [1] }
  });
  assert.equal(await responder.handleMessage({
    channel: 'channel', channelId: '20', username: 'owner', userId: '10', isBroadcaster: true, text: '測試', ts: 1
  }), 'filtered');
  await Promise.resolve();
  assert.equal(processed, false);

  const malformed = parseAIEnvelope('{"reply":"raw JSON must not leak"');
  assert.equal(malformed.reply, '');
});

test('auto capture dry-run performs no write', async () => {
  let remembers = 0;
  const responder = new AIChatResponder({
    config: { enabled: true },
    autoCaptureConfig: config({ dry_run: true }),
    memoryClient: {
      isEnabled: () => true,
      recall: async () => ({ memories: [] }),
      remember: async () => { remembers += 1; }
    }
  });
  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [humanMessage()],
    candidate: { fact: '台主的項鍊是自己製作的', kind: 'stable_fact', confidence: 0.92, evidence: [7] }
  });
  assert.equal(result.decision, 'dry-run');
  assert.equal(remembers, 0);
});
