const { TwitchChatCommand } = require('twitch-commando');
const util = require('util');
const moment = require('moment');
const ytSvc = require('../../../service/ytSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const {RateLimitedTwitchChatCommand} = require('../../../service/rateLimited');

class ViwersCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!Pekora人數',
      aliases: [ '!pekora人數', '!兔田人數', '!配可拉人數', '!佩克拉人數' ],
      group: 'streamers'
    });
  }

  async delayRun(msg) {
    try {
      let info = await ytSvc.getLiveInfoByChannelId('UCCzUftO8KOVkV4wQG1vkUvg');
      if ( info.actualEndTime ){
        msg.reply('兎田ぺこら現在沒開台，上次關台是'+ moment(info.actualEndTime).format("yyyy-MM-DD HH:mm") );   
      }else{
        msg.reply(`兎田ぺこら台現在有:${info.currentViewers}人`);
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;