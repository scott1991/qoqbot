const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const VECTOR_DIMENSIONS = 1024;
const RECALL_TOP_K = 8;
const RECALL_MIN_SCORE = 0.65;
const LIST_PAGE_SIZE = 5;
const MAX_MEMORY_CHARS = 400;
const MAX_STRUCTURE_CHARS = 120;
const MAX_QUERY_CHARS = 1000;
const MAX_SCHEDULED_WORK = 25;
const ALLOWED_KINDS = new Set(['stable_fact', 'preference', 'channel_lore']);
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function normalizeContent(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeContent(value).toLocaleLowerCase('zh-Hant').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function characterCount(value) {
  return Array.from(String(value || '')).length;
}

function isChannelId(value) {
  return /^\d{1,32}$/.test(String(value || ''));
}

function isPublicId(value) {
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(String(value || '').toUpperCase());
}

function createPublicId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = '';

  for (let index = 0; index < 8; index += 1) {
    id += CROCKFORD_BASE32[bytes[index] & 31];
  }

  return id;
}

function addDays(isoDate, days) {
  return new Date(new Date(isoDate).getTime() + (days * 24 * 60 * 60 * 1000)).toISOString();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function isAuthorized(request, env) {
  const token = String(env.API_TOKEN || '');
  const authorization = request.headers.get('Authorization') || '';
  return Boolean(token) && authorization === 'Bearer ' + token;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function resultChanges(result) {
  return Number(result && result.meta && result.meta.changes || 0);
}

function embeddingFrom(response) {
  const values = response && Array.isArray(response.data) ? response.data[0] : null;
  if (!Array.isArray(values) || values.length !== VECTOR_DIMENSIONS) {
    throw new Error('embedding response has unexpected dimensions');
  }
  return values;
}

async function getEmbedding(env, text) {
  return embeddingFrom(await env.AI.run(EMBEDDING_MODEL, { text: [text] }));
}

async function indexMemory(env, record) {
  try {
    const values = await getEmbedding(env, record.content);
    await env.MEMORY_INDEX.upsert([{
      id: record.id,
      values,
      namespace: record.channel_id
    }]);
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'ready', updated_at = ? WHERE id = ? AND deleted_at IS NULL AND review_state = 'active' AND vector_state = 'pending'"
    ).bind(new Date().toISOString(), record.id).run();
    return true;
  } catch (cause) {
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'pending', updated_at = ? WHERE id = ? AND deleted_at IS NULL AND review_state = 'active'"
    ).bind(new Date().toISOString(), record.id).run();
    console.warn('[memory-worker] index pending id=%s reason=%s', record.id, cause && cause.message || 'unknown');
    return false;
  }
}

async function deleteVector(env, id) {
  try {
    await env.MEMORY_INDEX.deleteByIds([id]);
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'ready', updated_at = ? WHERE id = ? AND vector_state = 'delete_pending'"
    ).bind(new Date().toISOString(), id).run();
    return true;
  } catch (cause) {
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'delete_pending', updated_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), id).run();
    console.warn('[memory-worker] vector delete pending id=%s reason=%s', id, cause && cause.message || 'unknown');
    return false;
  }
}

async function findByContentHash(env, channelId, contentHash) {
  return env.DB.prepare(
    'SELECT * FROM memories WHERE channel_id = ? AND content_hash = ?'
  ).bind(channelId, contentHash).first();
}

async function createOrRestoreMemory(env, channelId, content) {
  const contentHash = await sha256Hex(content);
  let record = await findByContentHash(env, channelId, contentHash);

  if (record && !record.deleted_at && record.review_state === 'active') {
    return { id: record.id, duplicate: true, accepted: true, decision: 'duplicate' };
  }

  const now = new Date().toISOString();
  if (record) {
    await env.DB.prepare(
      "UPDATE memories SET content = ?, source_type = 'manual', review_state = 'active', kind = 'stable_fact', confidence = NULL, observation_count = 1, last_observed_at = ?, subject = NULL, predicate = NULL, value = NULL, subject_key = NULL, predicate_key = NULL, value_key = NULL, recall_count = 0, last_recalled_at = NULL, retention_days = NULL, expires_at = NULL, superseded_by = NULL, vector_state = 'pending', deleted_at = NULL, updated_at = ? WHERE id = ?"
    ).bind(content, now, now, record.id).run();
    record = { ...record, content, channel_id: channelId, vector_state: 'pending', review_state: 'active', deleted_at: null };
  } else {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = createPublicId();
      try {
        const inserted = await env.DB.prepare(
          "INSERT INTO memories (id, channel_id, content, content_hash, vector_state, source_type, review_state, kind, observation_count, last_observed_at, recall_count, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 'pending', 'manual', 'active', 'stable_fact', 1, ?, 0, ?, ?, NULL)"
        ).bind(id, channelId, content, contentHash, now, now, now).run();

        if (resultChanges(inserted)) {
          record = { id, channel_id: channelId, content, vector_state: 'pending', review_state: 'active', deleted_at: null };
          break;
        }
      } catch (cause) {
        record = await findByContentHash(env, channelId, contentHash);
        if (record) break;
        if (attempt === 7) throw cause;
      }
    }
  }

  if (!record) throw new Error('could not allocate memory identifier');
  await indexMemory(env, record);
  return { id: record.id, duplicate: false, accepted: true, decision: 'saved' };
}

async function observeDuplicate(env, record, now, retentionDays) {
  const expiresAt = record.source_type === 'auto'
    ? addDays(now, Number(retentionDays || record.retention_days))
    : record.expires_at;
  await env.DB.prepare(
    'UPDATE memories SET observation_count = observation_count + 1, last_observed_at = ?, expires_at = ?, updated_at = ? WHERE id = ?'
  ).bind(now, expiresAt || null, now, record.id).run();
  return { id: record.id, duplicate: true, accepted: true, decision: 'duplicate' };
}

async function saveAutoRecord(env, input, contentHash, now) {
  let record = await findByContentHash(env, input.channelId, contentHash);
  const expiresAt = addDays(now, input.retentionDays);

  if (record) {
    await env.DB.prepare(
      "UPDATE memories SET content = ?, source_type = 'auto', review_state = 'active', kind = ?, confidence = ?, observation_count = observation_count + 1, last_observed_at = ?, subject = ?, predicate = ?, value = ?, subject_key = ?, predicate_key = ?, value_key = ?, retention_days = ?, expires_at = ?, superseded_by = NULL, vector_state = 'pending', deleted_at = NULL, updated_at = ? WHERE id = ?"
    ).bind(
      input.content,
      input.kind,
      input.confidence,
      now,
      input.subject,
      input.predicate,
      input.value,
      input.subjectKey,
      input.predicateKey,
      input.valueKey,
      input.retentionDays,
      expiresAt,
      now,
      record.id
    ).run();
    return { ...record, channel_id: input.channelId, content: input.content, review_state: 'active', vector_state: 'pending', deleted_at: null };
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createPublicId();
    try {
      const inserted = await env.DB.prepare(
        "INSERT INTO memories (id, channel_id, content, content_hash, vector_state, source_type, review_state, kind, confidence, observation_count, last_observed_at, subject, predicate, value, subject_key, predicate_key, value_key, recall_count, retention_days, expires_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 'pending', 'auto', 'active', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)"
      ).bind(
        id,
        input.channelId,
        input.content,
        contentHash,
        input.kind,
        input.confidence,
        now,
        input.subject,
        input.predicate,
        input.value,
        input.subjectKey,
        input.predicateKey,
        input.valueKey,
        input.retentionDays,
        expiresAt,
        now,
        now
      ).run();

      if (resultChanges(inserted)) {
        return { id, channel_id: input.channelId, content: input.content, review_state: 'active', vector_state: 'pending', deleted_at: null };
      }
    } catch (cause) {
      record = await findByContentHash(env, input.channelId, contentHash);
      if (record) return record;
      if (attempt === 7) throw cause;
    }
  }

  throw new Error('could not allocate memory identifier');
}

async function createAutoMemory(env, input) {
  const contentHash = await sha256Hex(input.content);
  const now = new Date().toISOString();
  const exact = await findByContentHash(env, input.channelId, contentHash);

  if (exact && !exact.deleted_at && exact.review_state === 'active') {
    return observeDuplicate(env, exact, now, input.retentionDays);
  }

  const current = await env.DB.prepare(
    "SELECT * FROM memories WHERE channel_id = ? AND subject_key = ? AND predicate_key = ? AND review_state = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1"
  ).bind(input.channelId, input.subjectKey, input.predicateKey).first();

  if (current && current.value_key === input.valueKey) {
    return observeDuplicate(env, current, now, input.retentionDays);
  }

  const record = await saveAutoRecord(env, input, contentHash, now);
  let supersededId = '';

  if (current && current.id !== record.id) {
    await env.DB.prepare(
      "UPDATE memories SET review_state = 'superseded', superseded_by = ?, vector_state = 'delete_pending', updated_at = ? WHERE id = ? AND review_state = 'active'"
    ).bind(record.id, now, current.id).run();
    supersededId = current.id;
  }

  await indexMemory(env, record);
  if (supersededId) await deleteVector(env, supersededId);

  return {
    id: record.id,
    duplicate: false,
    accepted: true,
    decision: supersededId ? 'superseded' : 'saved',
    ...(supersededId ? { superseded_id: supersededId } : {})
  };
}

async function listMemories(env, channelId, page) {
  const offset = (page - 1) * LIST_PAGE_SIZE;
  const now = new Date().toISOString();
  const [items, count] = await Promise.all([
    env.DB.prepare(
      "SELECT id, content, source_type, kind, observation_count, recall_count, created_at, updated_at, expires_at FROM memories WHERE channel_id = ? AND review_state = 'active' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(channelId, now, LIST_PAGE_SIZE, offset).all(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM memories WHERE channel_id = ? AND review_state = 'active' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
    ).bind(channelId, now).first()
  ]);

  return {
    page,
    page_size: LIST_PAGE_SIZE,
    total: Number(count && count.total || 0),
    memories: items.results || []
  };
}

async function forgetMemory(env, channelId, id) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE memories SET review_state = 'rejected', deleted_at = ?, vector_state = 'delete_pending', updated_at = ? WHERE id = ? AND channel_id = ? AND review_state = 'active' AND deleted_at IS NULL"
  ).bind(now, now, id, channelId).run();
  return resultChanges(result) > 0;
}

async function recordRecall(env, records, now) {
  await Promise.all(records.map(record => {
    const expiresAt = record.source_type === 'auto' && Number(record.retention_days) > 0
      ? addDays(now, Number(record.retention_days))
      : record.expires_at;
    return env.DB.prepare(
      'UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ?, expires_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, expiresAt || null, now, record.id).run();
  }));
}

async function recallMemories(env, channelId, query, options = {}) {
  const minScore = Number.isFinite(options.minScore) ? options.minScore : RECALL_MIN_SCORE;
  const limit = Number.isSafeInteger(options.limit) ? options.limit : RECALL_TOP_K;
  const values = await getEmbedding(env, query);
  const matchesResult = await env.MEMORY_INDEX.query(values, {
    topK: limit,
    namespace: channelId,
    returnMetadata: 'none'
  });
  const matches = (matchesResult && matchesResult.matches || []).filter(match => {
    return isPublicId(match && match.id) && Number(match.score) >= minScore;
  });
  const ids = matches.map(match => String(match.id).toUpperCase());

  if (!ids.length) return { memories: [] };

  const placeholders = ids.map(() => '?').join(', ');
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    "SELECT id, content, source_type, kind, confidence, subject, predicate, value, recall_count, retention_days, expires_at FROM memories WHERE channel_id = ? AND review_state = 'active' AND deleted_at IS NULL AND vector_state = 'ready' AND (expires_at IS NULL OR expires_at > ?) AND id IN (" + placeholders + ')'
  ).bind(channelId, now, ...ids).all();
  const byId = new Map((rows.results || []).map(row => [row.id, row]));
  const selected = matches.map(match => {
    const row = byId.get(String(match.id).toUpperCase());
    return row ? { ...row, score: Number(match.score) } : null;
  }).filter(Boolean);

  if (selected.length) await recordRecall(env, selected, now);

  return {
    memories: selected.map(row => ({
      id: row.id,
      content: row.content,
      score: row.score,
      source_type: row.source_type,
      kind: row.kind,
      confidence: row.confidence,
      subject: row.subject,
      predicate: row.predicate,
      value: row.value
    }))
  };
}

function parseAutoMemory(body) {
  const channelId = String(body && body.channel_id || '');
  const content = normalizeContent(body && body.content);
  const kind = String(body && body.kind || '');
  const confidence = Number(body && body.confidence);
  const subject = normalizeContent(body && body.subject);
  const predicate = normalizeContent(body && body.predicate).toLowerCase();
  const value = normalizeContent(body && body.value);
  const retentionDays = Number(body && body.retention_days);

  if (!isChannelId(channelId)) return { error: 'invalid channel_id' };
  if (!content || characterCount(content) > MAX_MEMORY_CHARS) return { error: 'content must be 1 to 400 characters' };
  if (!ALLOWED_KINDS.has(kind)) return { error: 'invalid kind' };
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { error: 'invalid confidence' };
  if (
    !subject ||
    !predicate ||
    !value ||
    characterCount(subject) > MAX_STRUCTURE_CHARS ||
    characterCount(predicate) > MAX_STRUCTURE_CHARS ||
    characterCount(value) > MAX_STRUCTURE_CHARS ||
    !/^[a-z][a-z0-9_]{1,63}$/.test(predicate)
  ) return { error: 'invalid fact structure' };
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    return { error: 'invalid retention_days' };
  }

  return {
    value: {
      channelId,
      content,
      kind,
      confidence,
      subject,
      predicate,
      value,
      subjectKey: normalizeKey(subject),
      predicateKey: normalizeKey(predicate),
      valueKey: normalizeKey(value),
      retentionDays
    }
  };
}

async function handleFetch(request, env, ctx) {
  if (!isAuthorized(request, env)) return error('unauthorized', 401);

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'POST' && path === '/v1/memories') {
    const body = await readJson(request);
    const channelId = String(body && body.channel_id || '');
    const content = normalizeContent(body && body.content);
    if (!isChannelId(channelId)) return error('invalid channel_id');
    if (!content || characterCount(content) > MAX_MEMORY_CHARS) return error('content must be 1 to 400 characters');

    try {
      return json(await createOrRestoreMemory(env, channelId, content), 201);
    } catch (cause) {
      console.error('[memory-worker] create failed reason=%s', cause && cause.message || 'unknown');
      return error('memory unavailable', 503);
    }
  }

  if (request.method === 'POST' && path === '/v1/auto-memories') {
    const parsed = parseAutoMemory(await readJson(request));
    if (parsed.error) return error(parsed.error);

    try {
      const result = await createAutoMemory(env, parsed.value);
      return json(result, result.duplicate ? 200 : 201);
    } catch (cause) {
      console.error('[memory-worker] auto create failed reason=%s', cause && cause.message || 'unknown');
      return error('memory unavailable', 503);
    }
  }

  if (request.method === 'GET' && path === '/v1/memories') {
    const channelId = url.searchParams.get('channel_id') || '';
    const page = Number(url.searchParams.get('page') || '1');
    if (!isChannelId(channelId)) return error('invalid channel_id');
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return error('invalid page');
    return json(await listMemories(env, channelId, page));
  }

  if (request.method === 'DELETE' && /^\/v1\/memories\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.slice('/v1/memories/'.length)).toUpperCase();
    const channelId = url.searchParams.get('channel_id') || '';
    if (!isChannelId(channelId) || !isPublicId(id)) return error('not found', 404);
    const deleted = await forgetMemory(env, channelId, id);
    if (!deleted) return error('not found', 404);
    ctx.waitUntil(deleteVector(env, id));
    return json({ id, deleted: true });
  }

  if (request.method === 'POST' && path === '/v1/recall') {
    const body = await readJson(request);
    const channelId = String(body && body.channel_id || '');
    const query = normalizeContent(body && body.query);
    const minScore = typeof (body && body.min_score) === 'undefined' ? RECALL_MIN_SCORE : Number(body.min_score);
    const limit = typeof (body && body.limit) === 'undefined' ? RECALL_TOP_K : Number(body.limit);
    if (!isChannelId(channelId)) return error('invalid channel_id');
    if (!query || characterCount(query) > MAX_QUERY_CHARS) return error('query must be 1 to 1000 characters');
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) return error('invalid min_score');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > RECALL_TOP_K) return error('invalid limit');

    try {
      return json(await recallMemories(env, channelId, query, { minScore, limit }));
    } catch (cause) {
      console.warn('[memory-worker] recall unavailable reason=%s', cause && cause.message || 'unknown');
      return error('memory unavailable', 503);
    }
  }

  return error('not found', 404);
}

async function expireUnusedMemories(env, now = new Date().toISOString()) {
  const expired = await env.DB.prepare(
    "SELECT id FROM memories WHERE source_type = 'auto' AND review_state = 'active' AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC LIMIT ?"
  ).bind(now, MAX_SCHEDULED_WORK).all();

  for (const record of expired.results || []) {
    await env.DB.prepare(
      "UPDATE memories SET review_state = 'expired', vector_state = 'delete_pending', updated_at = ? WHERE id = ? AND review_state = 'active'"
    ).bind(now, record.id).run();
  }

  return (expired.results || []).length;
}

async function runScheduledWork(env) {
  await expireUnusedMemories(env);
  const work = await env.DB.prepare(
    "SELECT id, channel_id, content, vector_state, review_state, deleted_at FROM memories WHERE vector_state IN ('pending', 'delete_pending') ORDER BY updated_at ASC LIMIT ?"
  ).bind(MAX_SCHEDULED_WORK).all();

  for (const record of work.results || []) {
    if (record.deleted_at || record.review_state !== 'active' || record.vector_state === 'delete_pending') {
      await deleteVector(env, record.id);
    } else {
      await indexMemory(env, record);
    }
  }
}

const worker = {
  fetch: handleFetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledWork(env));
  }
};

export default worker;
export {
  MAX_SCHEDULED_WORK,
  MAX_MEMORY_CHARS,
  MAX_QUERY_CHARS,
  RECALL_MIN_SCORE,
  RECALL_TOP_K,
  addDays,
  characterCount,
  createAutoMemory,
  createOrRestoreMemory,
  createPublicId,
  expireUnusedMemories,
  handleFetch,
  isAuthorized,
  isPublicId,
  normalizeContent,
  normalizeKey,
  parseAutoMemory,
  recallMemories,
  runScheduledWork
};
