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
      name: '!超負荷人數',
      aliases: [ '!負荷人數', '!張家盛人數', '!陣頭文化研究所所長人數', '!NL老公人數' ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await ytSvc.getLiveInfoByChannelId('UCGXr9L5Kg77hLMZN4r8X8mw');
      if ( info.actualEndTime ){
        msg.reply('超負荷現在沒開台，上次關台是'+ moment(info.actualEndTime).format("yyyy-MM-DD HH:mm") );   
      }else{
        msg.reply(`超負荷台現在有:${info.currentViewers}人`);
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;