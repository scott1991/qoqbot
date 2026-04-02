const fs = require('fs');
const path = require('path');
const got = require('got');

const DEFAULT_CONFIG = {
  enabled: false,
  debug: false,
  dry_run: false,
  reasoning: {
    enabled: false,
    effort: 'none'
  },
  base_url: 'https://example.com/v1',
  api_key: '',
  api_key_header: 'Authorization',
  api_key_prefix: 'Bearer ',
  extra_headers: {},
  metadata_rollout_bucket: {
    enabled: false,
    key: 'rollout_bucket',
    min: 0,
    max: 99
  },
  metadata_transport: 'body',
  metadata_header: '',
  model: 'gpt-4o-mini',
  bot_names: ['cakebaobao', 'qoqbot'],
  ignored_usernames: [],
  channels: [],
  min_messages: 3,
  cooldown_ms: 180000,
  max_retries: 1,
  retry_delay_ms: 1000,
  request_timeout_ms: 15000,
  append_response_model: false,
  retry_response_model_keywords: [],
  max_response_model_retries: 0,
  max_context_messages: 30,
  max_output_chars: 180,
  strip_think_tags: true,
  temperature: 0.8,
  system_prompt: 'You are a Twitch chat bot. Reply briefly, naturally, and stay relevant to the recent chat.'
};

const MAX_LOG_VALUE_LENGTH = 1000;
const MAX_CONTEXT_PREVIEW_LINES = 5;

function normalizeChannelName(channel) {
  if (!channel) {
    return '';
  }

  return String(channel).replace(/^#/, '').trim().toLowerCase();
}

function normalizeUsername(username) {
  if (!username) {
    return '';
  }

  return String(username).trim().toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRandomInteger(min, max) {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function getIntegerStringWidth(min, max) {
  return Math.max(String(Math.abs(Math.floor(min))).length, String(Math.abs(Math.floor(max))).length, 1);
}

function formatRolloutBucketValue(value, min, max) {
  const numericValue = Math.floor(value);
  const width = getIntegerStringWidth(min, max);

  if (numericValue < 0) {
    return '-' + String(Math.abs(numericValue)).padStart(width, '0');
  }

  return String(numericValue).padStart(width, '0');
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaders(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.keys(value).reduce((headers, key) => {
    const normalizedKey = String(key || '').trim();

    if (!normalizedKey) {
      return headers;
    }

    headers[normalizedKey] = String(value[key]);
    return headers;
  }, {});
}

function normalizeMetadata(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.keys(value).reduce((metadata, key) => {
    const normalizedKey = String(key || '').trim();

    if (!normalizedKey || typeof value[key] === 'undefined' || value[key] === null) {
      return metadata;
    }

    metadata[normalizedKey] = String(value[key]);
    return metadata;
  }, {});
}

function resolveConfigPath(filePath) {
  if (!filePath) {
    return '';
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), filePath);
}

function truncateForLog(value, maxLength) {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '...<truncated>';
}

function serializeForLog(value) {
  if (typeof value === 'undefined') {
    return '';
  }

  if (typeof value === 'string') {
    return truncateForLog(value, MAX_LOG_VALUE_LENGTH);
  }

  try {
    return truncateForLog(JSON.stringify(value), MAX_LOG_VALUE_LENGTH);
  } catch (error) {
    return '[unserializable:' + error.message + ']';
  }
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function loadSystemPrompt(promptFile, fallbackPrompt) {
  if (!promptFile) {
    return fallbackPrompt;
  }

  try {
    const resolvedPath = resolveConfigPath(promptFile);
    const prompt = fs.readFileSync(resolvedPath, 'utf8').trim();

    if (prompt) {
      return prompt;
    }

    console.log('[aichat] system prompt file is empty path=%s', resolvedPath);
  } catch (error) {
    console.log('[aichat] system prompt load failure path=%s error=%s', promptFile, error.message);
  }

  return fallbackPrompt;
}

class AIChatResponder {
  constructor(options) {
    const config = options && options.config ? options.config : {};
    const joinedChannels = options && options.joinedChannels ? options.joinedChannels : [];
    const clientUsername = options && options.clientUsername ? options.clientUsername : '';
    const ignoredUsernames = options && options.ignoredUsernames ? options.ignoredUsernames : [];

    this.clientUsername = normalizeUsername(clientUsername);
    this.config = this.buildConfig(config, this.clientUsername, ignoredUsernames);
    this.ignoredUsernames = new Set(this.config.ignored_usernames);
    this.joinedChannels = new Set(joinedChannels.map(normalizeChannelName).filter(Boolean));
    this.channelStates = new Map();
  }

  buildConfig(config, clientUsername, ignoredUsernames) {
    const merged = Object.assign({}, DEFAULT_CONFIG, config || {});
    const names = Array.isArray(merged.bot_names) ? merged.bot_names : [];
    const normalizedNames = names.map(normalizeUsername).filter(Boolean);
    const ignoredNames = []
      .concat(Array.isArray(merged.ignored_usernames) ? merged.ignored_usernames : [])
      .concat(Array.isArray(ignoredUsernames) ? ignoredUsernames : [])
      .map(normalizeUsername)
      .filter(Boolean);

    if (clientUsername && !normalizedNames.includes(clientUsername)) {
      normalizedNames.push(clientUsername);
    }

    merged.bot_names = normalizedNames.length ? normalizedNames : DEFAULT_CONFIG.bot_names.slice();
    merged.ignored_usernames = Array.from(new Set(ignoredNames));
    merged.channels = Array.isArray(merged.channels)
      ? merged.channels.map(normalizeChannelName).filter(Boolean)
      : [];
    merged.debug = Boolean(merged.debug);
    merged.dry_run = Boolean(merged.dry_run);

    if (!hasOwn(config, 'reasoning')) {
      merged.reasoning = Object.assign({}, DEFAULT_CONFIG.reasoning);
    } else if (config.reasoning === null) {
      merged.reasoning = null;
    } else if (isPlainObject(config.reasoning) && Object.keys(config.reasoning).length === 0) {
      merged.reasoning = {};
    } else {
      merged.reasoning = Object.assign({}, DEFAULT_CONFIG.reasoning, isPlainObject(config.reasoning) ? config.reasoning : {});
      merged.reasoning.enabled = Boolean(merged.reasoning.enabled);
      merged.reasoning.effort = String(merged.reasoning.effort || DEFAULT_CONFIG.reasoning.effort).trim() || DEFAULT_CONFIG.reasoning.effort;
    }

    merged.min_messages = Math.max(1, getFiniteNumber(merged.min_messages, DEFAULT_CONFIG.min_messages));
    merged.cooldown_ms = Math.max(0, getFiniteNumber(merged.cooldown_ms, DEFAULT_CONFIG.cooldown_ms));
    merged.max_retries = Math.max(0, Math.floor(getFiniteNumber(merged.max_retries, DEFAULT_CONFIG.max_retries)));
    merged.retry_delay_ms = Math.max(0, getFiniteNumber(merged.retry_delay_ms, DEFAULT_CONFIG.retry_delay_ms));
    merged.request_timeout_ms = Math.max(1, getFiniteNumber(merged.request_timeout_ms, DEFAULT_CONFIG.request_timeout_ms));
    merged.append_response_model = Boolean(merged.append_response_model);
    merged.retry_response_model_keywords = Array.isArray(merged.retry_response_model_keywords)
      ? merged.retry_response_model_keywords.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
      : DEFAULT_CONFIG.retry_response_model_keywords.slice();
    merged.max_response_model_retries = Math.max(0, Math.floor(getFiniteNumber(
      merged.max_response_model_retries,
      DEFAULT_CONFIG.max_response_model_retries
    )));
    merged.max_context_messages = Math.max(1, getFiniteNumber(merged.max_context_messages, DEFAULT_CONFIG.max_context_messages));
    merged.max_output_chars = Math.max(1, getFiniteNumber(merged.max_output_chars, DEFAULT_CONFIG.max_output_chars));
    merged.strip_think_tags = hasOwn(merged, 'strip_think_tags')
      ? Boolean(merged.strip_think_tags)
      : DEFAULT_CONFIG.strip_think_tags;
    merged.temperature = getFiniteNumber(merged.temperature, DEFAULT_CONFIG.temperature);
    merged.base_url = String(merged.base_url || DEFAULT_CONFIG.base_url).trim();
    merged.api_key = String(merged.api_key || '');
    merged.api_key_header = String(merged.api_key_header || DEFAULT_CONFIG.api_key_header).trim() || DEFAULT_CONFIG.api_key_header;
    merged.api_key_prefix = hasOwn(merged, 'api_key_prefix')
      ? String(merged.api_key_prefix)
      : DEFAULT_CONFIG.api_key_prefix;
    merged.extra_headers = normalizeHeaders(merged.extra_headers);
    merged.metadata_rollout_bucket = Object.assign(
      {},
      DEFAULT_CONFIG.metadata_rollout_bucket,
      isPlainObject(merged.metadata_rollout_bucket) ? merged.metadata_rollout_bucket : {}
    );
    merged.metadata_rollout_bucket.enabled = Boolean(merged.metadata_rollout_bucket.enabled);
    merged.metadata_rollout_bucket.key = String(
      merged.metadata_rollout_bucket.key || DEFAULT_CONFIG.metadata_rollout_bucket.key
    ).trim() || DEFAULT_CONFIG.metadata_rollout_bucket.key;
    merged.metadata_rollout_bucket.min = Math.floor(getFiniteNumber(
      merged.metadata_rollout_bucket.min,
      DEFAULT_CONFIG.metadata_rollout_bucket.min
    ));
    merged.metadata_rollout_bucket.max = Math.floor(getFiniteNumber(
      merged.metadata_rollout_bucket.max,
      DEFAULT_CONFIG.metadata_rollout_bucket.max
    ));
    merged.metadata_transport = String(merged.metadata_transport || DEFAULT_CONFIG.metadata_transport).trim().toLowerCase();
    merged.metadata_header = String(merged.metadata_header || DEFAULT_CONFIG.metadata_header).trim();
    merged.model = String(merged.model || DEFAULT_CONFIG.model).trim();
    merged.system_prompt_file = String(merged.system_prompt_file || '').trim();
    merged.system_prompt = String(merged.system_prompt || DEFAULT_CONFIG.system_prompt).trim();
    merged.system_prompt = loadSystemPrompt(merged.system_prompt_file, merged.system_prompt);

    return merged;
  }

  getState(channel) {
    if (!this.channelStates.has(channel)) {
      this.channelStates.set(channel, {
        messages: [],
        messagesSinceReply: 0,
        lastTriggerAt: 0,
        pending: false
      });
    }

    return this.channelStates.get(channel);
  }

  isEnabledForChannel(channel) {
    if (!this.config.enabled) {
      return false;
    }

    if (this.joinedChannels.size > 0 && !this.joinedChannels.has(channel)) {
      return false;
    }

    if (this.config.channels.length > 0 && !this.config.channels.includes(channel)) {
      return false;
    }

    return true;
  }

  isCommand(text) {
    return text.startsWith('!');
  }

  isMention(text) {
    const lowered = text.toLowerCase();

    return this.config.bot_names.some(name => {
      const pattern = new RegExp('(^|[^a-z0-9_])' + escapeRegex(name) + '([^a-z0-9_]|$)', 'i');
      return pattern.test(lowered);
    });
  }

  isBotMessage(username, isSelf) {
    if (isSelf) {
      return true;
    }

    return !!username && username === this.clientUsername;
  }

  isIgnoredUsername(username) {
    return !!username && this.ignoredUsernames.has(username);
  }

  debugLog(message) {
    if (this.config.debug) {
      console.log('[aichat] ' + message);
    }
  }

  isDryRun() {
    return this.config.dry_run;
  }

  addContextMessage(state, message) {
    state.messages.push(message);

    while (state.messages.length > this.config.max_context_messages) {
      state.messages.shift();
    }

    state.messagesSinceReply += 1;
  }

  buildContextLines(messages) {
    return messages.map(message => {
      const username = message.username || 'user';
      const text = String(message.text || '').replace(/\s+/g, ' ').trim();
      return username + ': ' + text;
    });
  }

  getRecentContextMessages(input) {
    return (input.messages || []).slice(-this.config.max_context_messages);
  }

  buildContextPreview(messages) {
    return this.buildContextLines((messages || []).slice(-MAX_CONTEXT_PREVIEW_LINES)).join(' | ');
  }

  buildReasoningRequest() {
    const reasoning = this.config.reasoning;

    if (reasoning === null || (isPlainObject(reasoning) && Object.keys(reasoning).length === 0)) {
      return null;
    }

    const requestReasoning = {};

    if (!isPlainObject(reasoning)) {
      return null;
    }

    if (hasOwn(reasoning, 'enabled')) {
      requestReasoning.enabled = Boolean(reasoning.enabled);
    }

    if (hasOwn(reasoning, 'effort')) {
      const effort = String(reasoning.effort || '').trim().toLowerCase();
      requestReasoning.effort = effort;
    }

    return Object.keys(requestReasoning).length > 0 ? requestReasoning : null;
  }

  buildRequestMetadata() {
    const metadata = {};
    const rolloutBucket = this.config.metadata_rollout_bucket;

    if (rolloutBucket && rolloutBucket.enabled) {
      metadata[rolloutBucket.key] = formatRolloutBucketValue(
        getRandomInteger(rolloutBucket.min, rolloutBucket.max),
        rolloutBucket.min,
        rolloutBucket.max
      );
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  buildRequestBody(input, recentMessages) {
    const messages = recentMessages || this.getRecentContextMessages(input);
    const recentLines = this.buildContextLines(messages);
    const userContent = [
      'Channel: ' + input.channel,
      'Trigger: ' + input.trigger,
      'Recent chat:',
      recentLines.length ? recentLines.join('\n') : '(none)'
    ].join('\n');

    const requestBody = {
      model: this.config.model,
      temperature: this.config.temperature,
      messages: [
        {
          role: 'system',
          content: this.config.system_prompt
        },
        {
          role: 'user',
          content: userContent
        }
      ]
    };

    const requestReasoning = this.buildReasoningRequest();

    if (requestReasoning) {
      requestBody.reasoning = requestReasoning;
    }

    if (
      this.config.metadata_transport !== 'header' &&
      isPlainObject(input.metadata) &&
      Object.keys(input.metadata).length > 0
    ) {
      requestBody.metadata = normalizeMetadata(input.metadata);
    }

    return requestBody;
  }

  getChatCompletionsUrl() {
    return this.config.base_url.replace(/\/+$/, '') + '/chat/completions';
  }

  extractTextContent(content) {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join(' ')
      .trim();
  }

  sanitizeReply(reply, maxLength) {
    if (!reply) {
      return '';
    }

    const limit = Number.isFinite(maxLength) ? Math.max(0, maxLength) : this.config.max_output_chars;
    const text = this.config.strip_think_tags ? this.stripThinkTags(reply) : String(reply);

    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  stripThinkTags(reply) {
    return String(reply || '')
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, ' ')
      .replace(/<\/?(think|thinking)\b[^>]*>/gi, ' ');
  }

  formatResponseModel(responseModel) {
    return String(responseModel || '')
      .trim()
      .replace(/:free\b/g, '')
      .trim();
  }

  formatReply(reply, responseModel) {
    const sanitizedReply = this.sanitizeReply(reply);
    const displayModel = this.formatResponseModel(responseModel);

    if (!sanitizedReply || !this.config.append_response_model || !displayModel) {
      return sanitizedReply;
    }

    const suffix = ' [' + displayModel + ']';

    if (suffix.length >= this.config.max_output_chars) {
      return suffix.slice(0, this.config.max_output_chars);
    }

    const trimmedReply = this.sanitizeReply(reply, this.config.max_output_chars - suffix.length);

    return trimmedReply + suffix;
  }

  formatApiError(error) {
    const meta = error && error.aichatMeta ? error.aichatMeta : {};
    const response = error && error.response ? error.response : {};
    const responseBody = typeof response.body === 'undefined' ? '' : serializeForLog(response.body);
    const responseHeaders = response.headers || {};
    const requestId = responseHeaders['x-request-id'] || responseHeaders['request-id'] || '';
    const statusCode = response.statusCode || '';
    const errorCode = error && error.code ? error.code : '';
    const bodyMessage = response.body && response.body.error && response.body.error.message
      ? String(response.body.error.message)
      : '';
    const debugRequestBody = this.config.debug && meta.requestBody
      ? 'request_body=' + serializeForLog(meta.requestBody)
      : '';

    return [
      'status=' + statusCode,
      'code=' + errorCode,
      'message=' + truncateForLog(error && error.message ? error.message : '', 300),
      'provider_message=' + truncateForLog(bodyMessage, 300),
      'request_id=' + requestId,
      'url=' + (meta.url || ''),
      'model=' + this.formatResponseModel(meta.model || ''),
      'context_count=' + String(meta.contextCount || 0),
      'oldest_age_ms=' + String(meta.oldestAgeMs || 0),
      'context_preview=' + serializeForLog(meta.contextPreview || ''),
      'response_body=' + responseBody,
      debugRequestBody
    ].filter(Boolean).join(' ');
  }

  isRetryableError(error) {
    if (!error) {
      return false;
    }

    const statusCode = error.response && error.response.statusCode ? Number(error.response.statusCode) : 0;

    if (statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429 || statusCode >= 500) {
      return true;
    }

    const retryableCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNABORTED'
    ]);

    return retryableCodes.has(String(error.code || '').toUpperCase()) || error.name === 'TimeoutError';
  }

  shouldRetryResponse(result) {
    const responseModel = String(result && result.responseModel ? result.responseModel : '').toLowerCase();
    const keywords = this.config.retry_response_model_keywords || [];

    if (!responseModel || keywords.length === 0) {
      return false;
    }

    return keywords.some(keyword => responseModel.includes(keyword));
  }

  async sendReplyRequest(input) {
    const headers = Object.assign({
      'Content-Type': 'application/json'
    }, this.config.extra_headers);
    const recentMessages = this.getRecentContextMessages(input);
    const oldestAgeMs = recentMessages.length > 0 ? input.now - recentMessages[0].ts : 0;
    const requestBody = this.buildRequestBody(input, recentMessages);

    if (this.config.api_key) {
      headers[this.config.api_key_header] = this.config.api_key_prefix + this.config.api_key;
    }

    if (
      this.config.metadata_transport === 'header' &&
      this.config.metadata_header &&
      isPlainObject(input.metadata) &&
      Object.keys(input.metadata).length > 0
    ) {
      headers[this.config.metadata_header] = JSON.stringify(normalizeMetadata(input.metadata));
    }

    console.log(
      '[aichat] sending channel=%s reason=%s context_count=%d oldest_age_ms=%d max_context_messages=%d metadata=%s',
      input.channel,
      input.trigger,
      recentMessages.length,
      oldestAgeMs,
      this.config.max_context_messages,
      serializeForLog(input.metadata || {})
    );

    let response;

    try {
      response = await got.post(this.getChatCompletionsUrl(), {
        json: requestBody,
        responseType: 'json',
        headers,
        timeout: {
          request: this.config.request_timeout_ms
        }
      });
    } catch (error) {
      error.aichatMeta = {
        url: this.getChatCompletionsUrl(),
        model: this.config.model,
        contextCount: recentMessages.length,
        oldestAgeMs: oldestAgeMs,
        contextPreview: this.buildContextPreview(recentMessages),
        requestBody: requestBody
      };
      throw error;
    }

    const body = response.body || {};
    const choice = Array.isArray(body.choices) ? body.choices[0] : null;
    const reply = choice && choice.message
      ? this.extractTextContent(choice.message.content)
      : (choice && typeof choice.text === 'string' ? choice.text : '');

    return {
      reply: this.sanitizeReply(reply),
      responseId: body.id || '',
      responseModel: body.model || '',
      responseProvider: body.provider || ''
    };
  }

  async requestReply(input) {
    let requestAttempt = 0;
    let errorRetries = 0;
    let responseModelRetries = 0;

    while (true) {
      requestAttempt += 1;

      try {
        const result = await this.sendReplyRequest(input);

        if (this.shouldRetryResponse(result) && responseModelRetries < this.config.max_response_model_retries) {
          responseModelRetries += 1;

          console.log(
            '[aichat] retry blocked-model channel=%s reason=%s attempt=%d blocked_model_retry=%d max_blocked_model_retries=%d delay_ms=%d response_model=%s',
            input.channel,
            input.trigger,
            requestAttempt,
            responseModelRetries,
            this.config.max_response_model_retries,
            this.config.retry_delay_ms,
            this.formatResponseModel(result.responseModel || '')
          );

          if (this.config.retry_delay_ms > 0) {
            await wait(this.config.retry_delay_ms);
          }

          continue;
        }

        if (this.shouldRetryResponse(result) && this.config.max_response_model_retries > 0) {
          console.log(
            '[aichat] blocked-model retries exhausted channel=%s reason=%s blocked_model_retries=%d response_model=%s',
            input.channel,
            input.trigger,
            responseModelRetries,
            this.formatResponseModel(result.responseModel || '')
          );
        }

        return result;
      } catch (error) {
        if (!this.isRetryableError(error) || errorRetries >= this.config.max_retries) {
          throw error;
        }

        errorRetries += 1;

        console.log(
          '[aichat] retry channel=%s reason=%s attempt=%d error_retry=%d max_error_retries=%d delay_ms=%d code=%s status=%s',
          input.channel,
          input.trigger,
          requestAttempt,
          errorRetries,
          this.config.max_retries,
          this.config.retry_delay_ms,
          error.code || '',
          error.response && error.response.statusCode ? error.response.statusCode : ''
        );

        if (this.config.retry_delay_ms > 0) {
          await wait(this.config.retry_delay_ms);
        }
      }
    }
  }

  async handleMessage(input) {
    const now = input && input.ts ? input.ts : Date.now();
    const channel = normalizeChannelName(input && input.channel);
    const username = normalizeUsername(input && input.username);
    const text = String((input && input.text) || '').trim();

    if (!channel || !username || !text) {
      this.debugLog('skip invalid payload channel=' + channel + ' username=' + username + ' textLength=' + text.length);
      return null;
    }

    if (!this.isEnabledForChannel(channel)) {
      this.debugLog('skip channel disabled channel=' + channel);
      return null;
    }

    if (this.isBotMessage(username, input && input.isSelf)) {
      this.debugLog('skip self channel=' + channel + ' username=' + username);
      return null;
    }

    if (this.isIgnoredUsername(username)) {
      this.debugLog('skip ignored-user channel=' + channel + ' username=' + username);
      return null;
    }

    const state = this.getState(channel);

    const isCommand = this.isCommand(text);
    const isMention = this.isMention(text);

    if (!isCommand) {
      this.addContextMessage(state, {
        username,
        text,
        ts: now
      });
    }

    const activityCount = state.messagesSinceReply;
    const trigger = isMention ? 'mention' : (activityCount >= this.config.min_messages ? 'activity' : '');

    if (!trigger) {
      this.debugLog('skip no-trigger channel=' + channel + ' username=' + username + ' count=' + activityCount + ' mention=' + String(isMention) + ' command=' + String(isCommand));
      return null;
    }

    if (state.pending) {
      // console.log('[aichat] skip pending channel=%s trigger=%s count=%d', channel, trigger, activityCount);
      return null;
    }

    if (state.lastTriggerAt && now - state.lastTriggerAt < this.config.cooldown_ms) {
      return null;
    }

    state.pending = true;
    state.lastTriggerAt = now;

    try {
      console.log('[aichat] trigger channel=%s reason=%s count=%d', channel, trigger, activityCount);
      const result = await this.requestReply({
        channel,
        trigger,
        messages: state.messages,
        now,
        metadata: this.buildRequestMetadata()
      });

      const reply = result && result.reply ? result.reply : '';

      if (!reply) {
        console.log('[aichat] skip empty channel=%s reason=%s', channel, trigger);
        return null;
      }

      const outputReply = this.formatReply(reply, result && result.responseModel ? result.responseModel : '');

      state.messagesSinceReply = 0;

      console.log(
        '[aichat] success channel=%s reason=%s dry_run=%s model=%s provider=%s id=%s',
        channel,
        trigger,
        this.isDryRun(),
        this.formatResponseModel(result.responseModel || ''),
        result.responseProvider || '',
        result.responseId || ''
      );
      return outputReply;
    } catch (error) {
      console.log('[aichat] api failure channel=%s reason=%s %s', channel, trigger, this.formatApiError(error));
      return null;
    } finally {
      state.pending = false;
    }
  }
}

module.exports = AIChatResponder;
