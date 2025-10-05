# QoqBot Copilot Instructions

QoqBot is a Chinese Twitch chatbot built on Node.js using the `twitch-commando` framework. It queries live viewer counts and stream status for Twitch and YouTube streamers.

## Architecture Overview

- **Entry Point**: `index.js` - Initializes TwitchCommandoClient with JSONProvider for persistent data
- **Commands**: Auto-loaded from `commands/` directory, organized by category:
  - `streamers/twitch/` - Twitch streamer viewer count queries
  - `streamers/yt/` - YouTube streamer viewer count queries  
  - `samples/` - Simple static responses
  - `querys/` - User information queries (followage, registration time)
- **Services**: Core business logic in `service/` directory
  - `twitchSvc.js` - Twitch API integration and web scraping
  - `ytSvc.js` - YouTube Data API integration
  - `rateLimited.js` - Rate limiting wrapper for commands

## Command Patterns

### Basic Static Response
```javascript
class SampleCommand extends TwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '安安安安安',
            group: 'samples',
            description: '安安'
        });
    }
    async run(msg) { msg.reply('安安 '); }
}
```

### Rate-Limited API Commands
All streamer commands extend `RateLimitedTwitchChatCommand` (cooldown from `config.json`):
```javascript
class ViwersCommand extends RateLimitedTwitchChatCommand {
    constructor(client) {
        super(client, {
            name: '!龜狗人數',
            aliases: [ '!小龜人數', '!龜哥人數' ],
            group: 'streamers'
        });
    }
    async delayRun(msg) { /* API call logic */ }
}
```

## Key Conventions

- **Chinese Interface**: All commands and responses are in Traditional Chinese
- **Naming**: Streamer commands follow pattern `!{nickname}人數` (viewer count)
- **Error Handling**: Always catch exceptions and reply `'我找不到欸'` (Can't find it)
- **Time Formatting**: Use moment.js with `zh-tw` locale for timestamps
- **Rate Limiting**: Commands have configurable cooldown via `cd` property in config

## Development Workflow

1. **Setup**: Copy `config.json.example` to `config.json` and add API keys
2. **Run**: `npm start` or `node index.js`
3. **Adding Streamers**: Create new files in `commands/streamers/{platform}/` following existing patterns
4. **Configuration**: Bot connects to channels defined in `index.js` channels array

## External Dependencies

- **Twitch**: Uses custom fork `github:scott1991/twitch-commando` + Helix API
- **YouTube**: YouTube Data API v3 for live stream information
- **Fallback**: Web scraping twitchtracker.com when APIs fail
- **Data**: JSONProvider stores persistent data in `database.json`

## Critical Files for New Commands

- Template: `commands/samples/sample1.js` for static responses
- Twitch: `commands/streamers/twitch/sweetcampercs.js` for API integration
- YouTube: `commands/streamers/yt/aqua.js` for YT Data API usage
- Rate limiting: `service/rateLimited.js` base class for cooldowns