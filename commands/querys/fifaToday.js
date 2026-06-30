const util = require('util');
const fifaSvc = require('../../service/fifaSvc');
const {RateLimitedTwitchChatCommand} = require('../../service/rateLimited');

const dayOffsets = {
    '昨天': -1,
    '今天': 0,
    '明天': 1,
    '後天': 2
};

function getDayOffset(day) {
    const normalizedDay = String(day || '').trim();

    if (Object.prototype.hasOwnProperty.call(dayOffsets, normalizedDay)) {
        return dayOffsets[normalizedDay];
    }

    return 0;
}

class FifaToday extends RateLimitedTwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '!fifa今天',
            aliases: ['!FIFA今天', '!世足今天','!fifa','!FIFA','!世足'],
            group: 'querys',
            description: 'querys fifa today scores',
            args: [
                {
                    name: 'day'
                }
            ]
        });
    }

    async delayRun(msg, { day } = {}) {
        try {
            const messages = await fifaSvc.getMessagesForDay(getDayOffset(day));

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
