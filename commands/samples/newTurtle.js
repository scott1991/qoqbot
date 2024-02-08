const { RateLimitedTwitchChatCommand } = require('../../service/rateLimited');
const utils = require('../../service/utils');

class SampleCommand extends RateLimitedTwitchChatCommand {
  constructor(client) {
    super(client, {
      name: '!74新龜',
      group: 'samples',
      description: '給新觀眾認識聊天室的規則',
    });
  }

  async delayRun(msg) {
    const messages = [
      '給剛來的觀眾了解這台的規則，基本上這台不會有新觀眾，⚪龜=被送訂閱的，⚫龜=連續被送兩個月的，如果你是黑白🐢請自覺的禁言自己，有顏色的🐢才有話語權',
      '麻煩請遵守聊天室守則，黑白🐢 是禁止發言的，維持良好聊天風氣人人有責 Twitch 󠀀',
      '📢 好消息！📢 好消息！📢 特大好消息！黑白🐢不要打字 peepoStop',
      '⚠️注意 收到免費的訂閱有可能會讓您成為 黑白🐢 ',
      '⚠️2023/4/12 黑白🐢之亂 是龜狗聊天室歷史上的大規模民變',
      '歡迎新觀眾！這裡沒有很多規則，但是有一點需要提醒：⚫龜=被送訂閱的龜，⚪龜=被送連續兩個月的龜。如果您是⚫⚪🐢，請自覺禁言自己，有顏色的🐢才有話語權。',
      '給新觀眾的提醒：⚫龜=被送訂閱的龜，⚪龜=被送連續兩個月的龜。⚫⚪🐢不需要打字，如果您是黑白龜，讓其他有顏色的龜能夠發言。',
      '您是否被送上訂閱成為⚫⚪🐢？不用擔心，這只是聊天室的一個小小驚喜。請繼續享受您的觀看體驗，但請記住，⚫⚪🐢禁止發言，讓聊天室更加和諧。',
      '有顏色的🐢龜才有話語權'
    ];
    const message = messages[utils.getRandomInt(messages.length)];

    if (message) {
      this.client.say(msg.channel.name, message); // 在聊天室中發送訊息
    }
  }
}
module.exports = SampleCommand;
