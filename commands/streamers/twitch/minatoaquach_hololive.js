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
      name: '!阿夸圖奇人數',
      aliases:  [ '!あくあ圖奇人數', '!阿垮圖奇人數', '!阿夸twitch人數', '!aqua圖奇人數', '!Aqua圖奇人數'  ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await twitchSvc.getLiveViewersCountByName('minatoaquach_hololive');
      if ( info.viewers ){
        msg.reply(`湊あくあ圖奇台現在有:${info.viewers}人`);
      }else{
        if ( info.time ){
          msg.reply('湊あくあ圖奇現在沒開台，上次關台是'+ moment( info.time).format("yyyy-MM-DD HH:mm"));  
        }else{
          msg.reply('湊あくあ圖奇現在沒開台');
        } 
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;