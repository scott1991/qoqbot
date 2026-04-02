const { TwitchCommandoClient } = require('twitch-commando');
const path = require('path');
const config = require('./config.json');
const JSONProvider = require('./provider/JSONProvider');
const AIChatResponder = require('./service/aiChatResponder');

const { oauth } = config;
const botUsername = 'cakebaobao';
const joinedChannels = ['sweetcampercs', 'cakebaobao'];

function normalizeUsername(username) {
    if (!username) {
        return '';
    }

    return String(username).trim().toLowerCase();
}

function buildIgnoredUsernames(usernames) {
    const values = Array.isArray(usernames) ? usernames : [];
    return new Set(values.map(normalizeUsername).filter(Boolean));
}

const ignoredUsernames = buildIgnoredUsernames(config.ignored_usernames);

var client = new TwitchCommandoClient({
    username: botUsername,
    oauth: oauth,
    channels: joinedChannels,
    botOwners: [
        botUsername
    ],
    prefix: "",
    logger: 'warn', // Set the log level to "warn"
});

const aiChatResponder = new AIChatResponder({
    config: config.aichat,
    joinedChannels: joinedChannels,
    clientUsername: botUsername,
    ignoredUsernames: config.ignored_usernames
});

const originalOnMessage = client.onMessage.bind(client);
client.onMessage = function (channel, userstate, messageText, self) {
    const username = normalizeUsername(userstate && userstate.username);

    if (ignoredUsernames.has(username)) {
        return;
    }

    return originalOnMessage(channel, userstate, messageText, self);
};

// const tmiClient = client._chatClient;
// tmiClient.options.log.level = 'warn';

// good for development and debugging
// client.enableVerboseLogging();

client.on('connected', () => {
    console.log('connected');
});

client.on('join', channel => {
    console.log('join');
});

client.on('error', err => {
    console.error(err);
});

client.registerDetaultCommands();
client.registerCommandsIn(path.join(__dirname, 'commands'));


async function setupAndConnect() {
    const provider = new JSONProvider(path.join(__dirname, 'database.json'));
    await provider.init(client); // Initialize the JSONProvider
    client.setProvider(provider); // Set the JSONProvider as the client's provider

    await client.connect();

    client.tmi.on('message', async (channel, userstate, messageText, self) => {
        const username = normalizeUsername(userstate && userstate.username);

        if (ignoredUsernames.has(username)) {
            return;
        }

        const reply = await aiChatResponder.handleMessage({
            channel: channel,
            username: username,
            text: messageText,
            ts: Date.now(),
            isSelf: self
        });

        if (reply) {
            if (aiChatResponder.isDryRun()) {
                console.log('[aichat] dry_run channel=%s reply=%s', channel, reply);
            } else {
                client.say(channel, reply);
            }
        }
    });
}

setupAndConnect().catch(console.error);
