const util = require('util');
const moment = require('moment');
const ytSvc = require('../../service/ytSvc');
const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const momentDurationFormatSetup = require("moment-duration-format");
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const configs = require('./config');

// Create command classes
const commands = configs.map((cfg, index) => {
  // Create a class with a unique name for each config
  const className = `YtViewerCommand${index}`;
  
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
        let info = await ytSvc.getLiveInfoByChannelId(this.cfg.youtubeChannelId);
        if (info.actualEndTime) {
          msg.reply(`${this.cfg.displayName}現在沒開台，上次關台是${moment(info.actualEndTime).format("yyyy-MM-DD HH:mm")}`);
        } else {
          msg.reply(`${this.cfg.displayName}台現在有:${info.currentViewers}人`);
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

console.log('Loaded YtViewerCommand.js, commands:', configs.length);