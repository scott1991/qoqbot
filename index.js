const { TwitchCommandoClient } = require('twitch-commando');
const path = require('path');
const { oauth } = require('./config.json');
const JSONProvider = require('./provider/JSONProvider');

var client = new TwitchCommandoClient({
    username: 'cakebaobao',
    oauth: oauth,
    channels: [ 'sweetcampercs', 'cakebaobao'],
    botOwners: [
        'cakebaobao'
    ],
    prefix: "",
    logger: 'warn', // Set the log level to "warn"
});

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

client.on('message', message => {
    // console.log(message);
});

client.registerDetaultCommands();
client.registerCommandsIn(path.join(__dirname, 'commands'));


async function setupAndConnect() {
    const provider = new JSONProvider(path.join(__dirname, 'database.json'));
    await provider.init(client); // Initialize the JSONProvider
    client.setProvider(provider); // Set the JSONProvider as the client's provider
    client.connect();
}

setupAndConnect().catch(console.error);

