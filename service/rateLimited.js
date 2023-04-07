const { TwitchChatCommand } = require("twitch-commando");
const { cd } = require('../config.json');

class RateLimitedTwitchChatCommand extends TwitchChatCommand {
  constructor(client, options) {
    super(client, options);
    this.rateLimit = options.rateLimit || 5000;
    this.lastCommandTimestamp = 0;
  }

  async run(msg) {
    const now = Date.now();

    if (now - this.lastCommandTimestamp >= this.rateLimit) {
      await this.delayRun(msg);
      this.lastCommandTimestamp = now;
    } else {
      setTimeout(async () => {
        //await this.delayRun(msg);
        this.lastCommandTimestamp = Date.now();
      }, this.rateLimit - (now - this.lastCommandTimestamp));
    }
  }

  async delayRun(msg) {
    // This method should be overridden in derived classes
  }
}

module.exports = {RateLimitedTwitchChatCommand:RateLimitedTwitchChatCommand};
