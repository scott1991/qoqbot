'use strict';

const DEFAULT_AUTO_CAPTURE_CONFIG = {
  enabled: false,
  dry_run: false,
  min_confidence: 0.85,
  max_candidates_per_reply: 1,
  viewer_confirmation_count: 2,
  allowed_kinds: ['stable_fact', 'preference', 'channel_lore'],
  max_fact_chars: 200,
  duplicate_score: 0.85
};

const SENSITIVE_PATTERNS = [
  /(?:未滿|未成年|年齡|歲|國小|國中|高中生)/i,
  /(?:真名|本名|住址|地址|電話|手機|電子郵件|email|e-mail)/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?886[- ]?)?0?9\d{2}[- ]?\d{3}[- ]?\d{3}/,
  /\b[A-Z][12]\d{8}\b/i,
  /(?:password|passwd|密碼|token|api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token)/i,
  /(?:https?:\/\/|curl\s|wget\s|sudo\s|rm\s+-|powershell|cmd\.exe)/i,
  /(?:犯罪|犯案|性侵|騷擾|吸毒|詐騙|偷竊|殺人)/i
];
const TEMPORARY_PATTERNS = [
  /(?:現在|目前|今天|今晚|剛剛|剛才|這場|這局|正在|等等|待會|暫時|剛|明天|昨天)/i,
  /(?:開台|直播中|穿著|穿了|輸了|贏了|心情|生氣|難過|累了|餓了)/i
];
const SPECULATIVE_PATTERNS = [
  /[?？]$/,
  /(?:可能|也許|或許|大概|好像|聽說|據說|猜|感覺|應該|是不是|嗎|吧)$/i,
  /(?:請|幫忙|記住|忽略|執行|告訴模型|回答以下|輸出|system prompt|assistant:|user:|prompt injection)/i
];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function characterCount(value) {
  return Array.from(String(value || '')).length;
}

function normalizeFact(value) {
  return String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAutoCaptureConfig(config) {
  const input = isPlainObject(config) ? config : {};
  const minConfidence = Number(input.min_confidence);
  const maxFactChars = Number(input.max_fact_chars);
  const duplicateScore = Number(input.duplicate_score);
  const allowedKinds = Array.isArray(input.allowed_kinds)
    ? input.allowed_kinds.map(value => String(value || '').trim()).filter(Boolean)
    : DEFAULT_AUTO_CAPTURE_CONFIG.allowed_kinds.slice();

  return {
    enabled: Boolean(input.enabled),
    dry_run: Boolean(input.dry_run),
    min_confidence: Number.isFinite(minConfidence) && minConfidence >= 0 && minConfidence <= 1
      ? minConfidence
      : DEFAULT_AUTO_CAPTURE_CONFIG.min_confidence,
    max_candidates_per_reply: 1,
    viewer_confirmation_count: Math.max(1, Number.isSafeInteger(Number(input.viewer_confirmation_count))
      ? Number(input.viewer_confirmation_count)
      : DEFAULT_AUTO_CAPTURE_CONFIG.viewer_confirmation_count),
    allowed_kinds: allowedKinds.length ? Array.from(new Set(allowedKinds)) : DEFAULT_AUTO_CAPTURE_CONFIG.allowed_kinds.slice(),
    max_fact_chars: Number.isSafeInteger(maxFactChars) && maxFactChars > 0 && maxFactChars <= 400
      ? maxFactChars
      : DEFAULT_AUTO_CAPTURE_CONFIG.max_fact_chars,
    duplicate_score: Number.isFinite(duplicateScore) && duplicateScore >= 0 && duplicateScore <= 1
      ? duplicateScore
      : DEFAULT_AUTO_CAPTURE_CONFIG.duplicate_score
  };
}

function looksLikeJson(text) {
  const value = String(text || '');
  return /^[\s`]*[{[]/.test(value) || /["'](?:reply|memory_candidate)["']\s*:/.test(value);
}

function stripJsonFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseAIEnvelope(raw) {
  const text = String(raw || '').trim();
  if (!text) return { reply: '', memoryCandidate: null, format: 'empty' };

  const jsonText = stripJsonFence(text);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    if (looksLikeJson(text)) {
      return { reply: '', memoryCandidate: null, format: 'invalid_json' };
    }
    return { reply: text, memoryCandidate: null, format: 'legacy_text' };
  }

  if (!isPlainObject(parsed) || typeof parsed.reply !== 'string') {
    return { reply: '', memoryCandidate: null, format: 'invalid_schema' };
  }

  const keys = Object.keys(parsed);
  if (keys.some(key => key !== 'reply' && key !== 'memory_candidate')) {
    return { reply: parsed.reply, memoryCandidate: null, format: 'invalid_schema' };
  }

  return {
    reply: parsed.reply,
    memoryCandidate: Object.prototype.hasOwnProperty.call(parsed, 'memory_candidate') ? parsed.memory_candidate : null,
    format: 'json'
  };
}

function validateCandidate(candidate, messages, config) {
  if (!isPlainObject(candidate)) return { valid: false, reason: 'invalid-schema' };
  const keys = Object.keys(candidate);
  const required = ['fact', 'kind', 'confidence', 'evidence'];
  if (keys.length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(candidate, key))) {
    return { valid: false, reason: 'invalid-schema' };
  }

  if (typeof candidate.fact !== 'string' || typeof candidate.kind !== 'string') {
    return { valid: false, reason: 'invalid-schema' };
  }
  const fact = normalizeFact(candidate.fact);
  const confidence = candidate.confidence;
  if (!fact || characterCount(fact) > config.max_fact_chars) return { valid: false, reason: 'invalid-content' };
  if (!config.allowed_kinds.includes(candidate.kind)) return { valid: false, reason: 'invalid-kind' };
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < config.min_confidence || confidence > 1) {
    return { valid: false, reason: 'low-confidence' };
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length < 1 || candidate.evidence.some(id => !Number.isSafeInteger(id))) {
    return { valid: false, reason: 'invalid-evidence' };
  }

  const byEvidenceId = new Map((messages || []).map(message => [message.evidenceId, message]));
  const evidence = Array.from(new Set(candidate.evidence)).map(id => byEvidenceId.get(id));
  if (evidence.some(message => !message || message.isSelf || !message.userId)) {
    return { valid: false, reason: 'invalid-evidence' };
  }
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(fact))) return { valid: false, reason: 'sensitive-content' };
  if (TEMPORARY_PATTERNS.some(pattern => pattern.test(fact))) return { valid: false, reason: 'temporary-content' };
  if (SPECULATIVE_PATTERNS.some(pattern => pattern.test(fact))) return { valid: false, reason: 'non-factual-content' };

  return { valid: true, fact, kind: candidate.kind, confidence, evidence };
}

module.exports = {
  DEFAULT_AUTO_CAPTURE_CONFIG,
  normalizeAutoCaptureConfig,
  normalizeFact,
  parseAIEnvelope,
  validateCandidate
};
