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
      name: '!赤鬼人數',
      aliases: [ '!赤鬼伯伯人數', '!老拍拍人數', '!老拍人數' ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let info = await twitchSvc.getLiveViewersCountByName('akaonikou1207');
      if ( info.viewers ){
        msg.reply(`赤鬼伯伯台現在有:${info.viewers}人`);
      }else{
        if ( info.time ){
          msg.reply('赤鬼伯伯現在沒開台，上次關台是'+ moment( info.time).format("yyyy-MM-DD HH:mm"));  
        }else{
          msg.reply('赤鬼伯伯現在沒開台');
        }
      }
       
    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;