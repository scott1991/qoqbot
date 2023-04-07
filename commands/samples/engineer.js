const { TwitchChatCommand } = require('twitch-commando');
const utils = require('../../service/utils');
class SampleCommand extends TwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '工程師',
            // aliases: [ 's' ],
            group: 'samples',
            description: '工程師'
        });
    }

    async run(msg) {
        let rnd = utils.getRandomInt(4);
        let rpmsg = null;
        switch (rnd) {
            case 0:
                rpmsg = `可不可以拜託你們考慮去其他地方租房子，這幾天我太太幾乎沒辦法睡覺，她原本就淺眠，這幾天精神快崩潰了 :(`;
                break;
            case 1:
                rpmsg = `麻煩貴戶🙏家中龜狗🐢不時半夜整晚玩遊戲🎮大吼大叫🤬到早上才消停🌞請考慮別人需要休息🥱(長期)😡`;
                break;
            case 2:
                rpmsg = `https://www.youtube.com/watch?v=mor-dfjUZOo`;
                break;
            case 3:
                // noop
                break;
        }
        if (rpmsg){
            msg.reply(rpmsg);
        }
        
    }
}

module.exports = SampleCommand;
