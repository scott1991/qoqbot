const util = require('util');
const path = require('path');
const AIChatResponder = require('../../service/aiChatResponder');

const responder = new AIChatResponder({
    config: {
        enabled: true,
        dry_run: true,
        model: 'dynamic/ailb1',
        system_prompt_file: path.join(__dirname, '../../prompts/aichat-system.txt'),
        max_context_messages: 20
    },
    joinedChannels: ['sweetcampercs'],
    clientUsername: 'cakebaobao'
});

const requestBody = responder.buildRequestBody({
    channel: 'sweetcampercs',
    trigger: 'activity',
    now: Date.now(),
    messages: [
        {
            username: 'cakebaobao',
            text: '哪有痛扁 明明贏麻了',
            isSelf: true,
            ts: Date.now() - 60000
        },
        {
            username: 'manboss',
            text: '@蛋糕寶寶 0.0 好吧 你說了算',
            ts: Date.now() - 50000
        },
        {
            username: 'cakebaobao',
            text: '@cheese141414 2026/07/08 賽程：00:00 阿根廷 vs 埃及｜04:00 瑞士 vs 哥倫比亞',
            isSelf: true,
            ts: Date.now() - 40000
        },
        {
            username: '7777414',
            text: 'em',
            ts: Date.now() - 30000
        }
    ]
});

console.log(util.inspect(requestBody, {
    depth: 6,
    colors: false
}));
