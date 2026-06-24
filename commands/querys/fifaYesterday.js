const util = require('util');
const fifaSvc = require('../../service/fifaSvc');
const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

class FifaYesterday extends RateLimitedTwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '!fifa昨天',
            aliases: ['!FIFA昨天', '!世足昨天'],
            group: 'querys',
            description: 'querys fifa yesterday scores'
        });
    }

    async delayRun(msg) {
        try {
            const messages = await fifaSvc.getMessagesForDay(-1);

            messages.forEach(message => {
                msg.reply(message);
            });
        } catch (e) {
            msg.reply('FIFA 賽程現在查不到，晚點再試');
            console.log(util.inspect(e, { depth: 3 }));
        }
    }
}

module.exports = FifaYesterday;
