const util = require('util');
const fifaSvc = require('../../service/fifaSvc');
const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

class FifaToday extends RateLimitedTwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '!fifa今天',
            aliases: ['!FIFA今天', '!世足今天','!fifa','!FIFA','!世足'],
            group: 'querys',
            description: 'querys fifa today scores'
        });
    }

    async delayRun(msg) {
        try {
            const messages = await fifaSvc.getMessagesForDay(0);

            messages.forEach(message => {
                msg.reply(message);
            });
        } catch (e) {
            msg.reply('FIFA 賽程現在查不到，晚點再試');
            console.log(util.inspect(e, { depth: 3 }));
        }
    }
}

module.exports = FifaToday;
