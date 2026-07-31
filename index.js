const path = require('path');
const WebSocket = require('ws');
const { QoqCommandoClient, normalizeMessageContext } = require('qoq-commando');
const config = require('./config.json');
const AIChatResponder = require('./service/aiChatResponder');
const AutoRefreshingTokenManager = require('./service/autoRefreshingTokenManager');
const { MemoryClient, validateMemoryConfig } = require('./service/memoryClient');
const TwitchConfigTokenProvider = require('./service/twitchConfigTokenProvider');

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

function normalizeUserId(userId) {
    return String(userId || '').trim();
}

function singleLineLogValue(value) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isUserIdLike(value) {
    return /^\d+$/.test(value);
}

function normalizeAccessToken(token) {
    return String(token || '').trim().replace(/^oauth:/i, '');
}

function getConfiguredChannel(botConfig) {
    const aiChannels = botConfig.aichat && botConfig.aichat.channels;
    return normalizeUsername(
        botConfig.channel ||
        (Array.isArray(aiChannels) && aiChannels[0]) ||
        'sweetcampercs'
    );
}

function buildIgnoredUsers(botConfig) {
    const usernames = new Set();
    const userIds = new Set();
    const values = []
        .concat(Array.isArray(botConfig.ignored_users) ? botConfig.ignored_users : [])
        .concat(Array.isArray(botConfig.ignored_usernames) ? botConfig.ignored_usernames : [])
        .concat(Array.isArray(botConfig.ignored_user_ids) ? botConfig.ignored_user_ids : []);

    values.forEach(value => {
        const text = String(value || '').trim();

        if (!text) {
            return;
        }

        if (isUserIdLike(text)) {
            userIds.add(normalizeUserId(text));
        } else {
            usernames.add(normalizeUsername(text));
        }
    });

    return { usernames, userIds };
}

function requireConfig(botConfig) {
    const missing = [];

    if (!String(botConfig.client_id || '').trim()) {
        missing.push('client_id');
    }
    if (!normalizeAccessToken(botConfig.user_access_token || botConfig.oauth)) {
        missing.push('user_access_token');
    }
    if (!String(botConfig.client_secret || '').trim()) {
        missing.push('client_secret');
    }
    if (!String(botConfig.user_refresh_token || '').trim()) {
        missing.push('user_refresh_token');
    }
    if (!getConfiguredChannel(botConfig)) {
        missing.push('channel');
    }

    if (missing.length > 0) {
        throw new Error(
            'Missing qoq-commando config: ' + missing.join(', ') +
            '. Copy the required fields from config.example.json.'
        );
    }

    validateMemoryConfig(botConfig.memory);
}

async function resolveTwitchIdentity(
    botConfig,
    fetchImpl = globalThis.fetch,
    tokenManager
) {
    const senderUserId = normalizeUserId(botConfig.sender_user_id);
    const broadcasterUserId = normalizeUserId(botConfig.broadcaster_user_id);
    const channel = getConfiguredChannel(botConfig);

    if (senderUserId && broadcasterUserId) {
        return { senderUserId, broadcasterUserId, channel };
    }

    const accessToken = tokenManager
        ? await tokenManager.getUserAccessToken()
        : normalizeAccessToken(botConfig.user_access_token || botConfig.oauth);
    const validationResponse = await fetchImpl('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + accessToken }
    });
    const validation = await validationResponse.json().catch(() => ({}));

    if (!validationResponse.ok || !validation.user_id) {
        throw new Error(
            'Unable to resolve sender_user_id from Twitch token: ' +
            (validation.message || validationResponse.statusText)
        );
    }

    const resolvedSenderUserId = senderUserId || normalizeUserId(validation.user_id);
    if (broadcasterUserId) {
        return {
            senderUserId: resolvedSenderUserId,
            broadcasterUserId,
            channel
        };
    }

    if (normalizeUsername(validation.login) === channel) {
        return {
            senderUserId: resolvedSenderUserId,
            broadcasterUserId: normalizeUserId(validation.user_id),
            channel
        };
    }

    const usersUrl = new URL('https://api.twitch.tv/helix/users');
    usersUrl.searchParams.set('login', channel);
    const userResponse = await fetchImpl(usersUrl, {
        headers: {
            Authorization: 'Bearer ' + accessToken,
            'Client-Id': botConfig.client_id
        }
    });
    const users = await userResponse.json().catch(() => ({}));
    const broadcaster = users.data && users.data[0];

    if (!userResponse.ok || !broadcaster || !broadcaster.id) {
        throw new Error(
            'Unable to resolve broadcaster_user_id for ' + channel + ': ' +
            (users.message || userResponse.statusText)
        );
    }

    return {
        senderUserId: resolvedSenderUserId,
        broadcasterUserId: normalizeUserId(broadcaster.id),
        channel
    };
}

class QoqBotClient extends QoqCommandoClient {
    constructor(options, aiChatResponder, ignoredUsers) {
        super(options);
        this.aiChatResponder = aiChatResponder;
        this.ignoredUsers = ignoredUsers;
        this.logChatMessages = options.logChatMessages === true;
    }

    async onEventSubMessage(event) {
        const msg = normalizeMessageContext(
            { ...event, client: this },
            { defaultChannel: this.channel }
        );
        const username = normalizeUsername(msg.username);
        const userId = normalizeUserId(msg.userId);

        if (this.logChatMessages) {
            console.log(
                '[chat] #%s %s: %s',
                singleLineLogValue(msg.channel || this.channel),
                singleLineLogValue(msg.displayName || username || 'unknown'),
                singleLineLogValue(msg.messageText)
            );
        }
        if (
            this.ignoredUsers.usernames.has(username) ||
            this.ignoredUsers.userIds.has(userId)
        ) {
            return undefined;
        }

        const commandResult = await super.onEventSubMessage(event);

        try {
            const reply = await this.aiChatResponder.handleMessage({
                channel: msg.channel,
                username,
                userId,
                channelId: msg.channelId || this.broadcasterUserId,
                text: msg.messageText,
                ts: Date.parse(msg.timestamp) || Date.now(),
                isSelf: userId === this.senderUserId
            });

            if (reply) {
                if (this.aiChatResponder.isDryRun()) {
                    console.log('[aichat] dry_run channel=%s reply=%s', msg.channel, reply);
                } else {
                    await this.say(msg.channel, reply);
                }
            }
        } catch (error) {
            console.error('[aichat] failed:', error);
        }

        return commandResult;
    }
}

function registerCommands(client) {
    client.registerCommandsIn(path.join(__dirname, 'commands', 'querys'));
    client.registerCommandsIn(path.join(__dirname, 'commands', 'samples'));
    client.registerCommand(require('./commands/streamers/ViewerCommand'));

    if (client.memoryClient && client.memoryClient.isEnabled()) {
        const memoryCommands = require('./commands/memory');
        client.registerCommand(memoryCommands.RememberCommand);
        client.registerCommand(memoryCommands.ListMemoriesCommand);
        client.registerCommand(memoryCommands.ForgetCommand);
    }
}

async function createClient(
    botConfig = config,
    fetchImpl = globalThis.fetch,
    runtimeOptions = {}
) {
    requireConfig(botConfig);

    const configPath = runtimeOptions.configPath || path.join(__dirname, 'config.json');
    const tokenProvider = new TwitchConfigTokenProvider({
        configPath,
        config: botConfig,
        normalizeAccessToken
    });
    await tokenProvider.secureFile();
    const tokenManager = new AutoRefreshingTokenManager({
        clientId: botConfig.client_id,
        clientSecret: botConfig.client_secret,
        tokenProvider,
        fetchImpl
    });
    await tokenManager.validate('user');

    const identity = await resolveTwitchIdentity(botConfig, fetchImpl, tokenManager);
    const ignoredUsers = buildIgnoredUsers(botConfig);
    const memoryConfig = validateMemoryConfig(botConfig.memory);
    const memoryClient = new MemoryClient({ config: memoryConfig, fetchImpl });
    const aiChatResponder = new AIChatResponder({
        config: botConfig.aichat,
        joinedChannels: [identity.channel],
        clientUsername: botConfig.bot_username || 'cakebaobao',
        ignoredUsers: botConfig.ignored_users,
        ignoredUsernames: botConfig.ignored_usernames,
        ignoredUserIds: botConfig.ignored_user_ids,
        memoryClient,
        memoryQueryMessages: memoryConfig.query_messages
    });

    const client = new QoqBotClient({
        clientId: botConfig.client_id,
        clientSecret: botConfig.client_secret,
        broadcasterUserId: identity.broadcasterUserId,
        senderUserId: identity.senderUserId,
        channel: identity.channel,
        prefix: '!',
        logChatMessages: botConfig.log_chat_messages === true,
        fetchImpl,
        webSocketFactory: url => new WebSocket(url),
        tokenManager
    }, aiChatResponder, ignoredUsers);
    client.memoryClient = memoryClient;

    client.eventSubGateway.on('session_welcome', () => {
        console.log('connected to Twitch EventSub for %s', identity.channel);
    });
    client.eventSubGateway.on('disconnected', () => {
        console.warn('disconnected from Twitch EventSub for %s', identity.channel);
    });
    client.eventSubGateway.on('error', error => {
        console.error(error);
    });

    registerCommands(client);
    return client;
}

async function setupAndConnect() {
    const client = await createClient();
    await client.connect();
    return client;
}

if (require.main === module) {
    setupAndConnect().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    QoqBotClient,
    buildIgnoredUsers,
    createClient,
    getConfiguredChannel,
    normalizeAccessToken,
    registerCommands,
    requireConfig,
    resolveTwitchIdentity,
    setupAndConnect
};
