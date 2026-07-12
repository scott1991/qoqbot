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

  async delayRun(msg, args = []) {
    const arg1 = args[0] || '';
    let regdt;
    try {
      let name = arg1 || msg.username;
      // this.client.say(msg.channel, '!accountage ' + name); // 在聊天室中發送訊息
      
      let userData = await twitchSvc.getUserByName(name);
      if (userData.body.createdAt) {
        regdt = moment(userData.body.createdAt);
        let duration = moment.duration(moment().diff(regdt)).format("y [年] M[月] d[天]");
        msg.reply(name + '是 ' + regdt.format("yyyy-MM-DD") + ' 也就是 ' + duration + '前註冊的');
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