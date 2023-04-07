const { TwitchChatCommand } = require('twitch-commando');
const { cd } = require('../../config.json');
class SampleCommand extends TwitchChatCommand
{
    constructor(client)
    {
        super(client, {
            name: '!cd',
            aliases: [ '!CD' ],
            group: 'samples',
            description: `指令目前CD時間是${cd/1000}秒`
        });
    }

    async run(msg)
    {
      msg.reply(`指令目前CD時間是${cd/1000}秒`); 
    }
}

module.exports = SampleCommand;
