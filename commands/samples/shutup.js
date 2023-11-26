const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const utils = require('../../service/utils');

class SampleCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!閉嘴',
      aliases: ['神之愛'],
      group: 'samples',
      description: '鬼話新聞紅蟻:閉嘴',
    });
  }

  async delayRun(msg) {
    this.client.say(msg.channel.name, "https://i.imgur.com/hDU35z8.png"); // 在聊天室中發送訊息
  }
}
module.exports = SampleCommand;
