const { TwitchChatCommand } = require("twitch-commando");
const { cd } = require('../config.json');

class RateLimitedTwitchChatCommand extends TwitchChatCommand {
  constructor(client, options) {
    super(client, options);
    this.rateLimit = cd;
    this.lastCommandTimestamp = 0;
  }

  async run(msg) {
    const now = Date.now();
    let t = now - this.lastCommandTimestamp ;
    if (t >= this.rateLimit) {
      await this.delayRun(msg);
      this.lastCommandTimestamp = now;
    } else {
      // console.log(t);
      /*
      setTimeout(async () => {
        //await this.delayRun(msg);
        this.lastCommandTimestamp = Date.now();
      }, this.rateLimit - (now - this.lastCommandTimestamp));
      */
    }
  }

  async delayRun(msg) {
    // This method should be overridden in derived classes
  }
}

module.exports = {RateLimitedTwitchChatCommand:RateLimitedTwitchChatCommand};
