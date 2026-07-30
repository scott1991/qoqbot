const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const VECTOR_DIMENSIONS = 1024;
const RECALL_TOP_K = 8;
const RECALL_MIN_SCORE = 0.65;
const LIST_PAGE_SIZE = 5;
const MAX_MEMORY_CHARS = 400;
const MAX_QUERY_CHARS = 1000;
const MAX_SCHEDULED_WORK = 25;
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
      "UPDATE memories SET vector_state = 'ready', updated_at = ? WHERE id = ? AND deleted_at IS NULL AND vector_state = 'pending'"
    ).bind(new Date().toISOString(), record.id).run();
    return true;
  } catch (cause) {
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'pending', updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).bind(new Date().toISOString(), record.id).run();
    console.warn('[memory-worker] index pending id=%s reason=%s', record.id, cause && cause.message || 'unknown');
    return false;
  }
}

async function deleteVector(env, id) {
  try {
    await env.MEMORY_INDEX.deleteByIds([id]);
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'ready', updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL"
    ).bind(new Date().toISOString(), id).run();
    return true;
  } catch (cause) {
    await env.DB.prepare(
      "UPDATE memories SET vector_state = 'delete_pending', updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL"
    ).bind(new Date().toISOString(), id).run();
    console.warn('[memory-worker] vector delete pending id=%s reason=%s', id, cause && cause.message || 'unknown');
    return false;
  }
}

async function createOrRestoreMemory(env, channelId, content) {
  const contentHash = await sha256Hex(content);
  let record = await env.DB.prepare(
    'SELECT id, channel_id, content, vector_state, deleted_at FROM memories WHERE channel_id = ? AND content_hash = ?'
  ).bind(channelId, contentHash).first();

  if (record && !record.deleted_at) {
    return { id: record.id, duplicate: true, accepted: true };
  }

  const now = new Date().toISOString();
  if (record) {
    await env.DB.prepare(
      "UPDATE memories SET content = ?, vector_state = 'pending', deleted_at = NULL, updated_at = ? WHERE id = ?"
    ).bind(content, now, record.id).run();
    record = { ...record, content, vector_state: 'pending', deleted_at: null };
  } else {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = createPublicId();
      try {
        const inserted = await env.DB.prepare(
          "INSERT INTO memories (id, channel_id, content, content_hash, vector_state, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)"
        ).bind(id, channelId, content, contentHash, now, now).run();

        if (resultChanges(inserted)) {
          record = { id, channel_id: channelId, content, vector_state: 'pending', deleted_at: null };
          break;
        }
      } catch (cause) {
        // A public-ID collision is extraordinarily unlikely. Check content dedupe before retrying.
        record = await env.DB.prepare(
          'SELECT id, channel_id, content, vector_state, deleted_at FROM memories WHERE channel_id = ? AND content_hash = ?'
        ).bind(channelId, contentHash).first();
        if (record) break;
        if (attempt === 7) throw cause;
      }
    }
  }

  if (!record) throw new Error('could not allocate memory identifier');
  if (!record.deleted_at && record.vector_state !== 'pending') {
    return { id: record.id, duplicate: true, accepted: true };
  }

  await indexMemory(env, record);
  return { id: record.id, duplicate: false, accepted: true };
}

async function listMemories(env, channelId, page) {
  const offset = (page - 1) * LIST_PAGE_SIZE;
  const [items, count] = await Promise.all([
    env.DB.prepare(
      'SELECT id, content, created_at, updated_at FROM memories WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(channelId, LIST_PAGE_SIZE, offset).all(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM memories WHERE channel_id = ? AND deleted_at IS NULL').bind(channelId).first()
  ]);

  return {
    page,
    page_size: LIST_PAGE_SIZE,
    total: Number(count && count.total || 0),
    memories: items.results || []
  };
}

async function forgetMemory(env, channelId, id) {
  const result = await env.DB.prepare(
    "UPDATE memories SET deleted_at = ?, vector_state = 'delete_pending', updated_at = ? WHERE id = ? AND channel_id = ? AND deleted_at IS NULL"
  ).bind(new Date().toISOString(), new Date().toISOString(), id, channelId).run();
  return resultChanges(result) > 0;
}

async function recallMemories(env, channelId, query) {
  const values = await getEmbedding(env, query);
  const matchesResult = await env.MEMORY_INDEX.query(values, {
    topK: RECALL_TOP_K,
    namespace: channelId,
    returnMetadata: 'none'
  });
  const matches = (matchesResult && matchesResult.matches || []).filter(match => {
    return isPublicId(match && match.id) && Number(match.score) >= RECALL_MIN_SCORE;
  });
  const ids = matches.map(match => String(match.id).toUpperCase());

  if (!ids.length) return { memories: [] };

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    "SELECT id, content FROM memories WHERE channel_id = ? AND deleted_at IS NULL AND vector_state = 'ready' AND id IN (" + placeholders + ')'
  ).bind(channelId, ...ids).all();
  const byId = new Map((rows.results || []).map(row => [row.id, row]));

  return {
    memories: matches.map(match => {
      const row = byId.get(String(match.id).toUpperCase());
      return row ? { id: row.id, content: row.content, score: Number(match.score) } : null;
    }).filter(Boolean)
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
    if (!isChannelId(channelId)) return error('invalid channel_id');
    if (!query || characterCount(query) > MAX_QUERY_CHARS) return error('query must be 1 to 1000 characters');

    try {
      return json(await recallMemories(env, channelId, query));
    } catch (cause) {
      console.warn('[memory-worker] recall unavailable reason=%s', cause && cause.message || 'unknown');
      return error('memory unavailable', 503);
    }
  }

  return error('not found', 404);
}

async function runScheduledWork(env) {
  const work = await env.DB.prepare(
    "SELECT id, channel_id, content, vector_state, deleted_at FROM memories WHERE vector_state IN ('pending', 'delete_pending') ORDER BY updated_at ASC LIMIT ?"
  ).bind(MAX_SCHEDULED_WORK).all();

  for (const record of work.results || []) {
    if (record.deleted_at || record.vector_state === 'delete_pending') {
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
  characterCount,
  createOrRestoreMemory,
  createPublicId,
  handleFetch,
  isAuthorized,
  isPublicId,
  normalizeContent,
  recallMemories,
  runScheduledWork
};
