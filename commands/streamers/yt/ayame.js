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
      name: '!百鬼人數',
      aliases: [ '!Ayame人數', '!ayame人數' ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await ytSvc.getLiveInfoByChannelId('UC7fk0CB07ly8oSl0aqKkqFg');
      if ( info.actualEndTime ){
        msg.reply('百鬼あやめ現在沒開台，上次關台是'+ moment(info.actualEndTime).format("yyyy-MM-DD HH:mm") );   
      }else{
        msg.reply(`百鬼あやめ台現在有:${info.currentViewers}人`);
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;