import { describe, expect, it } from 'vitest';
import { env as testEnv } from 'cloudflare:test';
import {
  characterCount,
  createAutoMemory,
  createOrRestoreMemory,
  expireUnusedMemories,
  isAuthorized,
  isPublicId,
  normalizeContent,
  normalizeKey,
  parseAutoMemory,
  recallMemories
} from './index.js';

describe('memory worker input guards', () => {
  it('requires its bearer secret and validates Crockford public IDs', () => {
    const env = { API_TOKEN: 'test-token' };
    expect(isAuthorized(new Request('https://worker.example/v1/memories', {
      headers: { Authorization: 'Bearer test-token' }
    }), env)).toBe(true);
    expect(isAuthorized(new Request('https://worker.example/v1/memories'), env)).toBe(false);
    expect(isPublicId('AB12CD34')).toBe(true);
    expect(isPublicId('AB12CID4')).toBe(false);
  });

  it('normalizes duplicate content without splitting unicode characters', () => {
    expect(normalizeContent('  cafe\u0301\n\t  test  ')).toBe('café test');
    expect(normalizeKey(' 阿 龜！ ')).toBe('阿龜');
    expect(characterCount('😀字')).toBe(2);
  });

  it('requires a complete structured auto-memory payload', () => {
    const parsed = parseAutoMemory({
      channel_id: '20',
      content: '阿龜的項鍊是自己製作的',
      kind: 'stable_fact',
      confidence: 0.92,
      subject: '阿龜',
      predicate: 'necklace_maker',
      value: '自己',
      retention_days: 365
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.value.subjectKey).toBe('阿龜');
    expect(parseAutoMemory({ ...parsed.value, channel_id: '20', predicate: '不合法關係' }).error).toBe('invalid fact structure');
  });

  it('keeps an active same-channel hash as a duplicate without generating another vector', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => ({
            id: 'AB12CD34', channel_id: '20', content: 'shared fact', vector_state: 'ready', review_state: 'active', deleted_at: null
          }) })
        })
      },
      AI: { run: async () => { throw new Error('must not embed duplicate'); } },
      MEMORY_INDEX: { upsert: async () => { throw new Error('must not upsert duplicate'); } }
    };

    await expect(createOrRestoreMemory(env, '20', 'shared fact')).resolves.toEqual({
      id: 'AB12CD34', duplicate: true, accepted: true, decision: 'duplicate'
    });
  });

  it('supersedes an active structured value and removes its old vector', async () => {
    const updates = [];
    const deletedVectors = [];
    const old = {
      id: 'AB12CD34',
      channel_id: '20',
      content: '阿龜喜歡紅茶',
      value_key: '紅茶',
      review_state: 'active',
      vector_state: 'ready',
      deleted_at: null
    };
    const env = {
      AI: { run: async () => ({ data: [Array.from({ length: 1024 }, () => 0)] }) },
      MEMORY_INDEX: {
        upsert: async () => undefined,
        deleteByIds: async ids => deletedVectors.push(...ids)
      },
      DB: {
        prepare: sql => ({
          bind: (...args) => ({
            first: async () => sql.includes('subject_key = ?') ? old : null,
            run: async () => {
              updates.push({ sql, args });
              return { meta: { changes: 1 } };
            }
          })
        })
      }
    };

    const result = await createAutoMemory(env, {
      channelId: '20',
      content: '阿龜喜歡綠茶',
      kind: 'preference',
      confidence: 0.95,
      subject: '阿龜',
      predicate: 'likes',
      value: '綠茶',
      subjectKey: '阿龜',
      predicateKey: 'likes',
      valueKey: '綠茶',
      retentionDays: 180
    });

    expect(result.decision).toBe('superseded');
    expect(result.superseded_id).toBe('AB12CD34');
    expect(result.id).not.toBe('AB12CD34');
    expect(deletedVectors).toEqual(['AB12CD34']);
    expect(updates.some(update => update.sql.includes("review_state = 'superseded'"))).toBe(true);
  });

  it('queries only the channel namespace, enforces topK and score, and lets D1 exclude deleted rows', async () => {
    let queryOptions;
    const env = {
      AI: { run: async () => ({ data: [Array.from({ length: 1024 }, () => 0)] }) },
      MEMORY_INDEX: {
        query: async (_values, options) => {
          queryOptions = options;
          return { matches: [
            { id: 'AB12CD34', score: 0.90 },
            { id: 'EF56GH78', score: 0.64 }
          ] };
        }
      },
      DB: {
        prepare: () => ({
          bind: () => ({
            // An empty D1 result models a soft-deleted/non-ready vector match.
            all: async () => ({ results: [] })
          })
        })
      }
    };

    await expect(recallMemories(env, '20', 'stream schedule')).resolves.toEqual({ memories: [] });
    expect(queryOptions).toEqual({ topK: 8, namespace: '20', returnMetadata: 'none' });
  });

  it('marks expired auto memories for vector cleanup', async () => {
    const updates = [];
    const env = {
      DB: {
        prepare: sql => ({
          bind: (...args) => ({
            all: async () => ({ results: [{ id: 'AB12CD34' }] }),
            run: async () => {
              updates.push({ sql, args });
              return { meta: { changes: 1 } };
            }
          })
        })
      }
    };

    await expect(expireUnusedMemories(env, '2026-08-06T00:00:00.000Z')).resolves.toBe(1);
    expect(updates[0].sql).toContain("review_state = 'expired'");
    expect(updates[0].sql).toContain("vector_state = 'delete_pending'");
  });

  it('persists structured versions in migrated D1 while keeping superseded history', async () => {
    const deletedVectors = [];
    const env = {
      DB: testEnv.DB,
      AI: { run: async () => ({ data: [Array.from({ length: 1024 }, () => 0)] }) },
      MEMORY_INDEX: {
        upsert: async () => undefined,
        deleteByIds: async ids => deletedVectors.push(...ids)
      }
    };
    const base = {
      channelId: '99001',
      kind: 'preference',
      confidence: 0.95,
      subject: '阿龜',
      predicate: 'likes',
      subjectKey: '阿龜',
      predicateKey: 'likes',
      retentionDays: 180
    };
    const first = await createAutoMemory(env, {
      ...base,
      content: '阿龜喜歡紅茶',
      value: '紅茶',
      valueKey: '紅茶'
    });
    const second = await createAutoMemory(env, {
      ...base,
      content: '阿龜喜歡綠茶',
      value: '綠茶',
      valueKey: '綠茶'
    });
    const rows = await testEnv.DB.prepare(
      'SELECT id, review_state, superseded_by FROM memories WHERE channel_id = ? ORDER BY created_at ASC'
    ).bind('99001').all();

    expect(first.decision).toBe('saved');
    expect(second.decision).toBe('superseded');
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({
      id: first.id,
      review_state: 'superseded',
      superseded_by: second.id
    });
    expect(rows.results[1]).toMatchObject({ id: second.id, review_state: 'active' });
    expect(deletedVectors).toContain(first.id);
  });

  it('recalls only active D1 records and renews an auto-memory lease', async () => {
    let queryOptions;
    let savedId;
    const env = {
      DB: testEnv.DB,
      AI: { run: async () => ({ data: [Array.from({ length: 1024 }, () => 0)] }) },
      MEMORY_INDEX: {
        upsert: async records => { savedId = records[0].id; },
        query: async (_values, options) => {
          queryOptions = options;
          return { matches: [{ id: savedId, score: 0.82 }] };
        },
        deleteByIds: async () => undefined
      }
    };
    await createAutoMemory(env, {
      channelId: '99002',
      content: '阿龜固定週五開台',
      kind: 'stable_fact',
      confidence: 0.93,
      subject: '阿龜',
      predicate: 'stream_schedule',
      value: '週五',
      subjectKey: '阿龜',
      predicateKey: 'streamschedule',
      valueKey: '週五',
      retentionDays: 365
    });
    const result = await recallMemories(env, '99002', '阿龜何時開台', { minScore: 0.8, limit: 4 });
    const row = await testEnv.DB.prepare(
      'SELECT recall_count, last_recalled_at, expires_at FROM memories WHERE id = ?'
    ).bind(savedId).first();

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({ id: savedId, kind: 'stable_fact' });
    expect(queryOptions).toEqual({ topK: 4, namespace: '99002', returnMetadata: 'none' });
    expect(row.recall_count).toBe(1);
    expect(row.last_recalled_at).toBeTruthy();
    expect(row.expires_at > row.last_recalled_at).toBe(true);
  });
});
