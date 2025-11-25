const { TwitchChatCommand } = require('twitch-commando');
const util = require('util');
const moment = require('moment');
const twitchSvc = require('../../service/twitchSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

class StreamStartTime extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!uptime',
      group: 'querys',
      description: 'querys stream start time',
      args: [
        {
          name: 'arg1'
        }
      ]
    });
  }

  async delayRun(msg) {
    let arg1 = '';
    try {
      let name = arg1 ? arg1 : msg.channel.name;
      // Remove # prefix if present
      name = name.replace(/^#/, '');
      console.log('Checking stream time for:', name);
      
      let streamInfo = await twitchSvc.getStreamStartTimeByName(name);
      
      if (streamInfo.isLive) {
        let startTime = moment(streamInfo.startTime);
        let duration = moment.duration(moment().diff(startTime)).format("H [小時] m [分鐘]");
        msg.reply(name + ' 從 ' + startTime.format("HH:mm") + ' 開始直播,已經開台 ' + duration);
      } else {
        let lastTime = moment(streamInfo.lastStreamTime);
        let duration = moment.duration(moment().diff(lastTime)).humanize();
        msg.reply(name + ' 目前不在線上,上次開台是 ' + duration + '前');
      }
      
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = StreamStartTime;
