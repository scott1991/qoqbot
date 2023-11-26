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
      name: '!蘆葦人數',
      aliases: [ '!luweibaby人數', "!蘆筍人數","!弓神人數","!詐欺師人數","!蘆葦伯人數","!滷肉飯人數","!滷雞腿人數","!蘆筍炒肉絲人數","!滷肉便當人數" ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await twitchSvc.getLiveViewersCountByName('luweibaby');
      if ( info.viewers ){
        msg.reply(`蘆葦台現在有:${info.viewers}人`);
      }else{
        if ( info.time ){
          msg.reply('蘆葦現在沒開台，上次關台是'+ moment( info.time).format("yyyy-MM-DD HH:mm"));  
        }else{
          msg.reply('蘆葦現在沒開台');
        } 
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;