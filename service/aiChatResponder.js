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
  model: 'gpt-4o-mini',
  bot_names: ['cakebaobao', 'qoqbot'],
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

    this.clientUsername = normalizeUsername(clientUsername);
    this.config = this.buildConfig(config, this.clientUsername);
    this.joinedChannels = new Set(joinedChannels.map(normalizeChannelName).filter(Boolean));
    this.channelStates = new Map();
  }

  buildConfig(config, clientUsername) {
    const merged = Object.assign({}, DEFAULT_CONFIG, config || {});
    const names = Array.isArray(merged.bot_names) ? merged.bot_names : [];
    const normalizedNames = names.map(normalizeUsername).filter(Boolean);

    if (clientUsername && !normalizedNames.includes(clientUsername)) {
      normalizedNames.push(clientUsername);
    }

    merged.bot_names = normalizedNames.length ? normalizedNames : DEFAULT_CONFIG.bot_names.slice();
    merged.channels = Array.isArray(merged.channels)
      ? merged.channels.map(normalizeChannelName).filter(Boolean)
      : [];
    merged.debug = Boolean(merged.debug);
    merged.dry_run = Boolean(merged.dry_run);
    merged.reasoning = Object.assign({}, DEFAULT_CONFIG.reasoning, merged.reasoning || {});
    merged.reasoning.enabled = Boolean(merged.reasoning.enabled);
    merged.reasoning.effort = String(merged.reasoning.effort || DEFAULT_CONFIG.reasoning.effort).trim() || DEFAULT_CONFIG.reasoning.effort;
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
    merged.temperature = getFiniteNumber(merged.temperature, DEFAULT_CONFIG.temperature);
    merged.base_url = String(merged.base_url || DEFAULT_CONFIG.base_url).trim();
    merged.api_key = String(merged.api_key || '');
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
    const reasoning = this.config.reasoning || {};
    const effort = String(reasoning.effort || '').trim().toLowerCase();

    if (!reasoning.enabled && (!effort || effort === 'none')) {
      return null;
    }

    const requestReasoning = {};

    if (reasoning.enabled) {
      requestReasoning.enabled = true;
    }

    if (effort && effort !== 'none') {
      requestReasoning.effort = effort;
    }

    return Object.keys(requestReasoning).length > 0 ? requestReasoning : null;
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

    return String(reply)
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  formatReply(reply, responseModel) {
    const sanitizedReply = this.sanitizeReply(reply);

    if (!sanitizedReply || !this.config.append_response_model || !responseModel) {
      return sanitizedReply;
    }

    const suffix = ' [' + String(responseModel).trim() + ']';

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
      'model=' + (meta.model || ''),
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
    const headers = {
      'Content-Type': 'application/json'
    };
    const recentMessages = this.getRecentContextMessages(input);
    const oldestAgeMs = recentMessages.length > 0 ? input.now - recentMessages[0].ts : 0;
    const requestBody = this.buildRequestBody(input, recentMessages);

    if (this.config.api_key) {
      headers.Authorization = 'Bearer ' + this.config.api_key;
    }

    console.log(
      '[aichat] sending channel=%s reason=%s context_count=%d oldest_age_ms=%d max_context_messages=%d',
      input.channel,
      input.trigger,
      recentMessages.length,
      oldestAgeMs,
      this.config.max_context_messages
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
            result.responseModel || ''
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
            result.responseModel || ''
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
      console.log('[aichat] skip pending channel=%s trigger=%s count=%d', channel, trigger, activityCount);
      return null;
    }

    if (state.lastTriggerAt && now - state.lastTriggerAt < this.config.cooldown_ms) {
      console.log('[aichat] skip cooldown channel=%s trigger=%s count=%d', channel, trigger, activityCount);
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
        now
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
        result.responseModel || '',
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
