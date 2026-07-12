const { QoqCommand } = require('qoq-commando');

class SampleCommand extends QoqCommand
{
    constructor(client)
    {
        super(client, {
            name: '安安安安安',
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
