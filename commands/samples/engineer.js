const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const utils = require('../../service/utils');

class SampleCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '工程師',
      group: 'samples',
      description: '工程師',
    });
  }

  async delayRun(msg) {
    const messages = [
      '可不可以拜託你們考慮去其他地方租房子，這幾天我太太幾乎沒辦法睡覺，她原本就淺眠，這幾天精神快崩潰了 :(',
      '麻煩貴戶🙏家中龜狗🐢不時半夜整晚玩遊戲🎮大吼大叫🤬到早上才消停🌞請考慮別人需要休息🥱(長期)😡',
      'https://www.youtube.com/watch?v=mor-dfjUZOo',
    ];
    const message = messages[utils.getRandomInt(messages.length)];

    if (message) {
      this.client.say(msg.channel.name, message); // 在聊天室中發送訊息
    }
  }
}

module.exports = SampleCommand;
