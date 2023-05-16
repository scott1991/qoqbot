const {
    TwitchCommandoClient, TwtichChatMessage, TwtichChatUser, CommandoSQLiteProvider, TwitchChatMessage
} = require('twitch-commando');
const util = require('util');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const { oauth } = require('./config.json');

var client = new TwitchCommandoClient({
    username: 'cakebaobao',
    oauth: oauth,
    channels: ['sweetcampercs', 'cakebaobao'],
    botOwners: [
        'cakebaobao'
    ],
    prefix:"",
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

client.setProvider(
    sqlite.open({ filename: path.join(__dirname, 'database.sqlite3'), driver: sqlite3.Database }).then(db => new CommandoSQLiteProvider(db))
);

client.connect();
