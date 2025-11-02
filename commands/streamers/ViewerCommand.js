const util = require('util');
const moment = require('moment');
const ytSvc = require('../../service/ytSvc');
const twitchSvc = require('../../service/twitchSvc');
const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const momentDurationFormatSetup = require('moment-duration-format');
momentDurationFormatSetup(moment);
moment.locale('zh-tw');

const configs = require('./config');
const extrasFlag = Symbol.for('qoqbot.viewerCommandsRegistered');

const createCommandClass = cfg => {
  return class ViewerCommand extends RateLimitedTwitchChatCommand {
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

        if (this.cfg.youtubeChannelId) {
          try {
            infoYt = await ytSvc.getLiveInfoByChannelId(this.cfg.youtubeChannelId);
          } catch (e) {
            console.log('YouTube API error:', e.message);
          }
        }

        if (this.cfg.twitchUsername) {
          try {
            infoTwitch = await twitchSvc.getLiveViewersCountByName(this.cfg.twitchUsername);
          } catch (e) {
            console.log('Twitch API error:', e.message);
          }
        }

        if (infoYt && infoYt.currentViewers && !infoYt.actualEndTime) {
          msg.reply(`${this.cfg.displayName}YT現在有:${infoYt.currentViewers}人`);
          return;
        }

        if (infoTwitch && infoTwitch.viewers) {
          msg.reply(`${this.cfg.displayName}圖奇現在有:${infoTwitch.viewers}人`);
          return;
        }

        let offlineStr = `${this.cfg.displayName}現在沒開台`;

        if (infoYt && infoYt.actualEndTime) {
          offlineStr += `，YT上次關台是${moment(infoYt.actualEndTime).format('yyyy-MM-DD HH:mm')}`;
        }

        if (infoTwitch && infoTwitch.time) {
          offlineStr += `，圖奇上次關台是${moment(infoTwitch.time).format('yyyy-MM-DD HH:mm')}`;
        }

        msg.reply(offlineStr);
      } catch (e) {
        msg.reply('我找不到欸');
        console.log(util.inspect(e, { depth: 3 }));
      }
    }
  };
};

const commandClasses = configs.map(createCommandClass);

if (commandClasses.length === 0) {
  throw new Error('ViewerCommand requires at least one configuration entry.');
}

const PrimaryCommand = commandClasses[0];

class ViewerCommand extends PrimaryCommand {
  constructor(client) {
    super(client);
    this.registerExtraCommands(client);
  }

  registerExtraCommands(client) {
    if (!client || !Array.isArray(client.commands) || client[extrasFlag]) {
      return;
    }

    commandClasses.slice(1).forEach(CommandClass => {
      const extraCommand = new CommandClass(client);
      if (client.logger && typeof client.logger.info === 'function') {
        client.logger.info(
          `Register command ${extraCommand.options.group}:${extraCommand.options.name}`
        );
      } else {
        console.log(`Register command ${extraCommand.options.group}:${extraCommand.options.name}`);
      }
      client.commands.push(extraCommand);
    });

    client[extrasFlag] = true;
  }
}

module.exports = ViewerCommand;

console.log('Loaded ViewerCommand.js, commands:', configs.length);
