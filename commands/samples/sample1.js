const { TwitchChatCommand } = require('twitch-commando');

class SampleCommand extends TwitchChatCommand
{
    constructor(client)
    {
        super(client, {
            name: '!安安安安',
            // aliases: [ 's' ],
            group: 'samples',
            description: '安安'
        });
    }

    async run(msg)
    {
      msg.reply('安安 '); 
    }
}

module.exports = SampleCommand;
