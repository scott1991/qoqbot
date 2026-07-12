const util = require('util');
const moment = require('moment');
const twitchSvc = require('../../service/twitchSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const {RateLimitedQoqBotCommand} = require('../../service/rateLimited');

class TwitchAccountRegistrationTime extends RateLimitedQoqBotCommand {
  constructor(client) {
    super(client, {
      name: '!追隨時間',
      group: 'querys',
      description: '',
      args: [
        {
          name: 'arg1'
        }
      ]
    });
  }

  async delayRun(msg, args = []) {
    const arg1 = args[0] || '';
    try {
      const name = arg1 || msg.username;
      this.client.say(msg.channel, '!followage ' + name);
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = TwitchAccountRegistrationTime;