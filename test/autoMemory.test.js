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
  return normalizeAutoCaptureConfig(Object.assign({
    enabled: true,
    min_confidence: 0.85,
    max_fact_chars: 200
  }, overrides));
}

function humanMessage(overrides = {}) {
  return Object.assign({
    evidenceId: 1,
    username: 'streamer',
    userId: '10',
    isBroadcaster: true,
    text: '我的項鍊是自己做的'
  }, overrides);
}

function candidate(overrides = {}) {
  return Object.assign({
    fact: '阿龜的項鍊是自己製作的',
    kind: 'stable_fact',
    confidence: 0.92,
    evidence: [1],
    subject: '阿龜',
    predicate: 'necklace_maker',
    value: '自己'
  }, overrides);
}

function makeResponder(autoCaptureOverrides = {}, memoryOverrides = {}) {
  const memoryClient = Object.assign({
    isEnabled: () => true,
    recall: async () => ({ memories: [] }),
    rememberAuto: async () => ({ id: 'AB12CD34', decision: 'saved' })
  }, memoryOverrides);

  return new AIChatResponder({
    config: { enabled: true, min_messages: 1, cooldown_ms: 0 },
    joinedChannels: ['channel'],
    memoryClient,
    autoCaptureConfig: Object.assign({ enabled: true }, autoCaptureOverrides)
  });
}

test('structured AI response isolates reply and memory candidate', () => {
  const envelope = parseAIEnvelope(JSON.stringify({
    reply: '原來項鍊是自己做的',
    memory_candidate: candidate()
  }));

  assert.equal(envelope.reply, '原來項鍊是自己做的');
  assert.deepEqual(envelope.memoryCandidate, candidate());
  assert.equal(envelope.format, 'json');
});

test('system prompt keeps policy separate from the appended response format contract', () => {
  const responder = new AIChatResponder({
    config: {
      enabled: true,
      system_prompt_file: 'prompts/aichat-system.txt'
    }
  });
  const request = responder.buildRequestBody({
    channel: 'channel',
    trigger: 'activity',
    now: 1000,
    memoryFacts: []
  }, []);
  const policyPrompt = responder.config.system_prompt;
  const completeSystemPrompt = request.messages[0].content;

  assert.match(policyPrompt, /【長期記憶候選判斷】/);
  assert.doesNotMatch(policyPrompt, /【固定 JSON 與記憶候選】|候選格式：|完整 JSON 只能包含/);
  assert.equal((completeSystemPrompt.match(/Return exactly one JSON object/g) || []).length, 1);
  assert.equal((completeSystemPrompt.match(/"fact":"standalone durable fact"/g) || []).length, 1);
});

test('legacy plain text remains compatible but cannot create a candidate', () => {
  assert.deepEqual(parseAIEnvelope('普通文字回覆'), {
    reply: '普通文字回覆',
    memoryCandidate: null,
    format: 'legacy_text'
  });
});

test('malformed JSON-like output is never exposed as chat reply', () => {
  const envelope = parseAIEnvelope('{"reply":"不能洩漏","memory_candidate":');
  assert.equal(envelope.reply, '');
  assert.equal(envelope.memoryCandidate, null);
  assert.equal(envelope.format, 'invalid_json');
});

test('candidate validation accepts only valid recent human evidence', () => {
  const valid = validateCandidate(candidate(), [humanMessage()], config());
  assert.equal(valid.valid, true);
  assert.equal(valid.fact, '阿龜的項鍊是自己製作的');

  const botEvidence = validateCandidate(candidate(), [humanMessage({ isSelf: true })], config());
  assert.deepEqual(botEvidence, { valid: false, reason: 'invalid-evidence' });

  const missingEvidence = validateCandidate(candidate({ evidence: [99] }), [humanMessage()], config());
  assert.deepEqual(missingEvidence, { valid: false, reason: 'invalid-evidence' });

  const missingStructure = candidate();
  delete missingStructure.subject;
  assert.deepEqual(validateCandidate(missingStructure, [humanMessage()], config()), {
    valid: false,
    reason: 'invalid-schema'
  });
});

test('candidate validation rejects temporary, sensitive, and speculative content', () => {
  const messages = [humanMessage()];

  assert.equal(
    validateCandidate(candidate({ fact: '阿龜現在正在直播' }), messages, config()).reason,
    'temporary-content'
  );
  assert.equal(
    validateCandidate(candidate({ fact: '阿龜的電話是 0912-345-678' }), messages, config()).reason,
    'sensitive-content'
  );
  assert.equal(
    validateCandidate(candidate({ fact: '阿龜的信箱是 turtle@example.com' }), messages, config()).reason,
    'sensitive-content'
  );
  assert.equal(
    validateCandidate(candidate({ fact: '阿龜喜歡喝茶嗎？' }), messages, config()).reason,
    'non-factual-content'
  );
});

test('recent human messages receive stable evidence IDs while bot output does not', () => {
  const responder = makeResponder();
  const state = responder.getState('channel');

  responder.addContextMessage(state, humanMessage({ evidenceId: undefined }), { countActivity: true });
  responder.addContextMessage(state, {
    username: 'qoqbot',
    userId: '99',
    text: 'bot reply',
    isSelf: true
  }, { countActivity: false });
  responder.addContextMessage(state, humanMessage({ evidenceId: undefined, userId: '11' }), { countActivity: true });

  assert.equal(state.messages[0].evidenceId, 1);
  assert.equal(state.messages[1].evidenceId, undefined);
  assert.equal(state.messages[2].evidenceId, 2);
  assert.match(responder.buildContextLines(state.messages)[0], /^\[evidence 1\]/);
  assert.doesNotMatch(responder.buildContextLines(state.messages)[1], /\[evidence/);
});

test('broadcaster durable fact is sent to the structured auto-memory endpoint', async () => {
  const calls = [];
  const responder = makeResponder({}, {
    rememberAuto: async (channelId, savedCandidate) => {
      calls.push({ operation: 'rememberAuto', channelId, candidate: savedCandidate });
      return { id: 'AB12CD34', decision: 'saved' };
    }
  });

  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [humanMessage()],
    candidate: candidate()
  });

  assert.deepEqual(result, { decision: 'saved', id: 'AB12CD34' });
  assert.deepEqual(calls.map(call => call.operation), ['rememberAuto']);
  assert.equal(calls[0].candidate.predicate, 'necklace_maker');
});

test('a single viewer candidate is rejected before write', async () => {
  let calls = 0;
  const responder = makeResponder({}, {
    rememberAuto: async () => { calls += 1; return { id: 'AB12CD34' }; }
  });

  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [humanMessage({ isBroadcaster: false })],
    candidate: candidate()
  });

  assert.deepEqual(result, { decision: 'rejected', reason: 'insufficient-confirmation' });
  assert.equal(calls, 0);
});

test('independent viewer confirmations can create an active memory without review', async () => {
  let savedCandidate;
  const responder = makeResponder({ viewer_confirmation_count: 2 }, {
    rememberAuto: async (_channelId, value) => {
      savedCandidate = value;
      return { id: 'NEW00001', decision: 'saved' };
    }
  });

  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [
      humanMessage({ isBroadcaster: false, userId: '11', evidenceId: 1 }),
      humanMessage({ isBroadcaster: false, userId: '12', evidenceId: 2 })
    ],
    candidate: candidate({ evidence: [1, 2], kind: 'channel_lore' })
  });

  assert.deepEqual(result, { decision: 'saved', id: 'NEW00001' });
  assert.equal(savedCandidate.kind, 'channel_lore');
});

test('a conflicting structured fact reports the superseded version', async () => {
  const responder = makeResponder({}, {
    rememberAuto: async () => ({
      id: 'NEW00001',
      decision: 'superseded',
      superseded_id: 'OLD00001'
    })
  });

  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [humanMessage()],
    candidate: candidate()
  });

  assert.deepEqual(result, {
    decision: 'superseded',
    id: 'NEW00001',
    supersededId: 'OLD00001'
  });
});

test('dry-run validates and deduplicates without writing', async () => {
  let rememberCalls = 0;
  const responder = makeResponder({ dry_run: true }, {
    rememberAuto: async () => { rememberCalls += 1; return { id: 'NEW' }; }
  });

  const result = await responder.processMemoryCandidate({
    channelId: '20',
    messages: [humanMessage()],
    candidate: candidate()
  });

  assert.deepEqual(result, { decision: 'dry-run' });
  assert.equal(rememberCalls, 0);
});

test('filtered reply never schedules an auto-memory candidate', async () => {
  let candidateCalls = 0;
  const responder = makeResponder();
  responder.recallMemories = async () => [];
  responder.requestReply = async () => ({
    reply: 'filtered',
    memoryCandidate: candidate(),
    responseModel: 'test'
  });
  responder.processMemoryCandidate = async () => {
    candidateCalls += 1;
    return { decision: 'saved' };
  };

  const reply = await responder.handleMessage({
    channel: 'channel',
    channelId: '20',
    username: 'streamer',
    userId: '10',
    isBroadcaster: true,
    text: 'qoqbot hello',
    ts: 1000
  });

  assert.equal(reply, 'filtered');
  assert.equal(candidateCalls, 0);
});
