'use strict';

const { QoqCommand } = require('qoq-commando');

const MAX_MEMORY_CHARS = 400;
const LIST_PAGE_SIZE = 5;

function characterCount(value) {
  return Array.from(String(value || '')).length;
}

function truncate(value, maxChars) {
  const characters = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
  return characters.length > maxChars
    ? characters.slice(0, maxChars - 1).join('') + '…'
    : characters.join('');
}

function isOwner(client, msg) {
  return String(msg && msg.userId || '').trim() === String(client.senderUserId || '').trim();
}

function getChannelId(client, msg) {
  return String((msg && (msg.channelId || msg.broadcasterUserId)) || client.broadcasterUserId || '').trim();
}

class MemoryCommand extends QoqCommand {
  constructor(client, options) {
    super(client, options);
  }

  canRun(msg) {
    return isOwner(this.client, msg) && !!getChannelId(this.client, msg) && !!this.client.memoryClient;
  }
}

class RememberCommand extends MemoryCommand {
  constructor(client) {
    super(client, { name: '記住', group: 'memory', description: '儲存頻道共用記憶' });
  }

  async run(msg, args = []) {
    if (!this.canRun(msg)) return undefined;
    const content = args.join(' ').trim();
    const length = characterCount(content);

    if (!content || length > MAX_MEMORY_CHARS) {
      return msg.reply('記憶內容需為 1～400 字');
    }

    try {
      const result = await this.client.memoryClient.remember(getChannelId(this.client, msg), content);
      return msg.reply('記住了 [' + String(result.id || '').toUpperCase() + ']');
    } catch (error) {
      console.warn('[memory] remember failed code=%s status=%s', error.code || '', error.statusCode || '');
      return msg.reply('記憶服務目前無法使用');
    }
  }
}

class ListMemoriesCommand extends MemoryCommand {
  constructor(client) {
    super(client, { name: '記憶', group: 'memory', description: '列出頻道記憶' });
  }

  async run(msg, args = []) {
    if (!this.canRun(msg)) return undefined;
    const requestedPage = args.length ? Number(args[0]) : 1;

    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      return msg.reply('頁碼必須是正整數');
    }

    try {
      const result = await this.client.memoryClient.list(getChannelId(this.client, msg), requestedPage);
      const memories = Array.isArray(result.memories) ? result.memories : [];

      if (!memories.length) {
        return msg.reply('沒有記憶');
      }

      const entries = memories.slice(0, LIST_PAGE_SIZE).map(memory => {
        return '[' + String(memory.id || '').toUpperCase() + '] ' + truncate(memory.content, 60);
      });
      return msg.reply('記憶第 ' + requestedPage + ' 頁：' + entries.join(' ｜ '));
    } catch (error) {
      console.warn('[memory] list failed code=%s status=%s', error.code || '', error.statusCode || '');
      return msg.reply('記憶服務目前無法使用');
    }
  }
}

class ForgetCommand extends MemoryCommand {
  constructor(client) {
    super(client, { name: '忘記', group: 'memory', description: '刪除頻道記憶' });
  }

  async run(msg, args = []) {
    if (!this.canRun(msg)) return undefined;
    const id = String(args[0] || '').trim().toUpperCase();

    if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(id)) {
      return msg.reply('找不到這筆記憶');
    }

    try {
      const result = await this.client.memoryClient.forget(getChannelId(this.client, msg), id);
      return msg.reply(result.deleted ? '忘記了 [' + id + ']' : '找不到這筆記憶');
    } catch (error) {
      if (error.statusCode === 404) return msg.reply('找不到這筆記憶');
      console.warn('[memory] forget failed code=%s status=%s', error.code || '', error.statusCode || '');
      return msg.reply('記憶服務目前無法使用');
    }
  }
}

module.exports = {
  ForgetCommand,
  ListMemoriesCommand,
  RememberCommand,
  characterCount,
  getChannelId,
  isOwner,
  truncate
};
