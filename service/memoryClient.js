'use strict';

const DEFAULT_MEMORY_CONFIG = {
  enabled: false,
  base_url: '',
  api_token: '',
  request_timeout_ms: 3000
};

class MemoryClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MemoryClientError';
    this.statusCode = options.statusCode || 0;
    this.code = options.code || '';
  }
}

function getFiniteTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0
    ? Math.floor(timeout)
    : DEFAULT_MEMORY_CONFIG.request_timeout_ms;
}

function buildMemoryConfig(config) {
  const input = config && typeof config === 'object' ? config : {};

  return {
    enabled: Boolean(input.enabled),
    base_url: String(input.base_url || '').trim().replace(/\/+$/, ''),
    api_token: String(input.api_token || '').trim(),
    request_timeout_ms: getFiniteTimeout(input.request_timeout_ms)
  };
}

function validateMemoryConfig(config) {
  const normalized = buildMemoryConfig(config);

  if (!normalized.enabled) {
    return normalized;
  }

  const missing = [];
  if (!normalized.base_url) missing.push('memory.base_url');
  if (!normalized.api_token) missing.push('memory.api_token');

  if (missing.length) {
    throw new Error('Memory is enabled but missing required config: ' + missing.join(', '));
  }

  return normalized;
}

class MemoryClient {
  constructor(options = {}) {
    this.config = buildMemoryConfig(options.config);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  isEnabled() {
    return this.config.enabled;
  }

  async remember(channelId, content) {
    return this.request('/v1/memories', {
      method: 'POST',
      body: { channel_id: String(channelId), content: String(content) }
    });
  }

  async list(channelId, page = 1) {
    const query = new URLSearchParams({ channel_id: String(channelId), page: String(page) });
    return this.request('/v1/memories?' + query.toString());
  }

  async forget(channelId, id) {
    const query = new URLSearchParams({ channel_id: String(channelId) });
    return this.request('/v1/memories/' + encodeURIComponent(String(id)) + '?' + query.toString(), {
      method: 'DELETE'
    });
  }

  async recall(channelId, query) {
    return this.request('/v1/recall', {
      method: 'POST',
      body: { channel_id: String(channelId), query: String(query) }
    });
  }

  async request(path, options = {}) {
    if (!this.isEnabled()) {
      throw new MemoryClientError('Memory is disabled', { code: 'MEMORY_DISABLED' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
    const headers = { Authorization: 'Bearer ' + this.config.api_token };
    const requestOptions = {
      method: options.method || 'GET',
      headers,
      signal: controller.signal
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await this.fetchImpl(this.config.base_url + path, requestOptions);
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new MemoryClientError('Memory service request failed', {
          statusCode: response.status,
          code: body && body.error ? 'MEMORY_SERVICE_ERROR' : 'MEMORY_HTTP_ERROR'
        });
      }

      return body;
    } catch (error) {
      if (error instanceof MemoryClientError) {
        throw error;
      }

      const code = error && error.name === 'AbortError' ? 'MEMORY_TIMEOUT' : 'MEMORY_REQUEST_FAILED';
      throw new MemoryClientError('Memory service unavailable', { code });
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  DEFAULT_MEMORY_CONFIG,
  MemoryClient,
  MemoryClientError,
  buildMemoryConfig,
  validateMemoryConfig
};
