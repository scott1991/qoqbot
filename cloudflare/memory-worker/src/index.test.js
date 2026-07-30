import { describe, expect, it } from 'vitest';
import {
  characterCount,
  createOrRestoreMemory,
  isAuthorized,
  isPublicId,
  normalizeContent,
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
    expect(characterCount('😀字')).toBe(2);
  });

  it('keeps an active same-channel hash as a duplicate without generating another vector', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => ({
            id: 'AB12CD34', channel_id: '20', content: 'shared fact', vector_state: 'ready', deleted_at: null
          }) })
        })
      },
      AI: { run: async () => { throw new Error('must not embed duplicate'); } },
      MEMORY_INDEX: { upsert: async () => { throw new Error('must not upsert duplicate'); } }
    };

    await expect(createOrRestoreMemory(env, '20', 'shared fact')).resolves.toEqual({
      id: 'AB12CD34', duplicate: true, accepted: true
    });
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
});
