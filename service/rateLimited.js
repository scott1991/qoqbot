const { RateLimitedQoqCommand } = require('qoq-commando');
const { cd } = require('../config.json');

function withoutPrefix(value) {
  return String(value || '').replace(/^!/, '');
}

class RateLimitedQoqBotCommand extends RateLimitedQoqCommand {
  constructor(client, options) {
    const name = withoutPrefix(options.name).toLowerCase();
    const aliases = [...new Set(
      (options.aliases || []).map(alias => withoutPrefix(alias).toLowerCase())
    )].filter(alias => alias !== name);

    super(client, {
      ...options,
      name,
      aliases,
      cooldownMs: options.cooldownMs || cd,
      cooldownScope: options.cooldownScope || 'global'
    });
  }
}

module.exports = { RateLimitedQoqBotCommand };
