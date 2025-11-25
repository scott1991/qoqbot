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
      name: '!註冊時間',
      group: 'querys',
      description: 'querys account registration time',
      args: [
        {
          name: 'arg1'
        }
      ]
    });
  }

  async delayRun(msg) {
    let arg1 = '' ;
    let regdt;
    try {
      let name = arg1 ? arg1 : msg.author.username;
      // this.client.say(msg.channel.name, '!accountage ' + name); // 在聊天室中發送訊息
      
      let userData = await twitchSvc.getUserByName(name);
      if (userData.body.createdAt) {
        regdt = moment(userData.body.createdAt);
        let duration = moment.duration(moment().diff(regdt)).format("y [年] M[月] d[天]");
        msg.reply(arg1 + '是 ' + regdt.format("yyyy-MM-DD") + ' 也就是 ' + duration + '前註冊的');
      } else {
        msg.reply('我找不到欸');
      }
      
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = TwitchAccountRegistrationTime;