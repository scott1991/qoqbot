const { TwitchChatCommand } = require('twitch-commando');
const util = require('util');
const moment = require('moment');
const twitchSvc = require('../../../service/twitchSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const {RateLimitedTwitchChatCommand} = require('../../../service/rateLimited');

class ViwersCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!冠賢人數',
      aliases: [ '!阿賢人數', '!吳冠賢人數' ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await twitchSvc.getLiveViewersCountByName('gunguno');
      if ( info.viewers ){
        msg.reply(`冠賢台現在有:${info.viewers}人`);
      }else{
        if ( info.time ){
          msg.reply('冠賢現在沒開台，上次關台是'+ moment( info.time).format("yyyy-MM-DD HH:mm"));  
        }else{
          msg.reply('冠賢現在沒開台');
        }  
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;