const { TwitchChatCommand } = require('twitch-commando');
const util = require('util');
const moment = require('moment');
const twitchSvc = require('../../../service/twitchSvc');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const { RateLimitedTwitchChatCommand } = require('../../../service/rateLimited');
class ViwersCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!神之愛人數',
      aliases: [ '!eddy人數', '!Eddy人數', '!EddyTommy人數', '!愛哥人數', '!愛醬人數','eddytommy人數' ],
      group: 'streamers',
      description: ''
    });
  }

  async delayRun(msg) {
    try {
      let infoTwitch = await twitchSvc.getLiveViewersCountByName('eddytommy30');
      let infoYt = await ytSvc.getLiveInfoByChannelId('UCiJ0I4szok8aMxsWU8iTF_Q');
      if (infoYt.viewers) {
        msg.reply(`神之愛YT現在有:${info.viewers}人`);
      } else if (infoTwitch.viewers) {
        msg.reply(`神之愛圖奇現在有:${infoTwitch.viewers}人`);
      } else {
        let offlineStr = '神之愛現在沒開台';
        if (infoTwitch.time) {
          offlineStr += ',YT上次關台是' + moment(infoTwitch.time).format("yyyy-MM-DD HH:mm");
        }
        if (infoYt.actualEndTime) {
          offlineStr += ',圖奇上次關台是' + moment(infoYt.actualEndTime).format("yyyy-MM-DD HH:mm");
        }

        msg.reply(offlineStr);
      }

    } catch (e) {
      msg.reply('我找不到欸');
      console.log(util.inspect(e, { depth: 3 }))
    }
  }
}

module.exports = ViwersCommand;