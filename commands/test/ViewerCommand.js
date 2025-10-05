const util = require('util');
const moment = require('moment');
const ytSvc = require('../../service/ytSvc');
const twitchSvc = require('../../service/twitchSvc');
const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const configs = require('./config');

// Create command classes
const commands = configs.map((cfg, index) => {
  // Create a class with a unique name for each config
  const className = `ViewerCommand${index}`;
  
  const CommandClass = class extends RateLimitedTwitchChatCommand {
    constructor(client) {
      super(client, {
        name: cfg.command,
        aliases: cfg.aliases,
        group: 'streamers',
        description: `查詢${cfg.displayName}的觀看人數`
      });
      this.cfg = cfg;
    }

    async delayRun(msg) {
      try {
        let infoYt = null;
        let infoTwitch = null;

        // Check YouTube if channel ID is provided
        if (this.cfg.youtubeChannelId) {
          try {
            infoYt = await ytSvc.getLiveInfoByChannelId(this.cfg.youtubeChannelId);
          } catch (e) {
            console.log('YouTube API error:', e.message);
          }
        }

        // Check Twitch if username is provided
        if (this.cfg.twitchUsername) {
          try {
            infoTwitch = await twitchSvc.getLiveViewersCountByName(this.cfg.twitchUsername);
          } catch (e) {
            console.log('Twitch API error:', e.message);
          }
        }

        // Priority: YouTube live > Twitch live > offline status
        if (infoYt && infoYt.currentViewers && !infoYt.actualEndTime) {
          msg.reply(`${this.cfg.displayName}YT現在有:${infoYt.currentViewers}人`);
        } else if (infoTwitch && infoTwitch.viewers) {
          msg.reply(`${this.cfg.displayName}圖奇現在有:${infoTwitch.viewers}人`);
        } else {
          // Handle offline status
          let offlineStr = `${this.cfg.displayName}現在沒開台`;
          
          if (infoYt && infoYt.actualEndTime) {
            offlineStr += `，YT上次關台是${moment(infoYt.actualEndTime).format("yyyy-MM-DD HH:mm")}`;
          }
          
          if (infoTwitch && infoTwitch.time) {
            offlineStr += `，圖奇上次關台是${moment(infoTwitch.time).format("yyyy-MM-DD HH:mm")}`;
          }
          
          msg.reply(offlineStr);
        }
      } catch (e) {
        msg.reply('我找不到欸');
        console.log(util.inspect(e, { depth: 3 }));
      }
    }
  };
  
  // Set the class name for better debugging
  Object.defineProperty(CommandClass, 'name', { value: className });
  
  return CommandClass;
});

// Export the commands - twitch-commando expects a single export per file
// So we export the first command as default and add others as properties
module.exports = commands[0];

// Add additional commands as properties
commands.slice(1).forEach((cmd, index) => {
  module.exports[`Command${index + 1}`] = cmd;
});

console.log('Loaded ViewerCommand.js, commands:', configs.length);