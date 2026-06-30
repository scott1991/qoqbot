const util = require('util');
const fifaSvc = require('../../service/fifaSvc');
const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

class FifaAfterTomorrow extends RateLimitedTwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '!fifa後天',
            aliases: ['!FIFA後天', '!世足後天'],
            group: 'querys',
            description: 'querys fifa after tomorrow scores'
        });
    }

    async delayRun(msg) {
        try {
            const messages = await fifaSvc.getMessagesForDay(2);

            messages.forEach(message => {
                msg.reply(message);
            });
        } catch (e) {
            msg.reply('FIFA 賽程現在查不到，晚點再試');
            console.log(util.inspect(e, { depth: 3 }));
        }
    }
}

module.exports = FifaAfterTomorrow;
