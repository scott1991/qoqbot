const { TwitchChatCommand } = require('twitch-commando');
const util = require('util');
const moment = require('moment');
const twitchSvc = require('../../service/twitchSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

class TwitchAccountRegistrationTime extends RateLimitedTwitchChatCommand {
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

  async delayRun(msg) {
    let arg1 = '' ;
    try {
      let name = arg1 ? arg1 : msg.author.username;
      this.client.say(msg.channel.name, '!followage ' + name); 
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = TwitchAccountRegistrationTime;