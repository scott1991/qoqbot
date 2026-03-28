# Repository Guidelines

## Project Structure & Module Organization
The bot entrypoint is `index.js`, which creates the `TwitchCommandoClient`, loads `config.json`, initializes `provider/JSONProvider.js`, and registers commands from `commands/`. Most user-facing commands live in `commands/streamers` and `commands/querys`. `commands/streamers/ViewerCommand.js` is a generated-style command loader that registers many viewer-count commands from `commands/streamers/config.js`, so add or update streamer definitions there instead of creating one file per streamer. Keep fixed-response or experimental commands in `commands/samples`, and put one-off verification scripts in `commands/test` or the root `test.js`. Shared API and utility code belongs in `service/`, and persisted channel data is stored in `database.json`.

## Build, Test, and Development Commands
Run `npm install` after cloning. Use `npm start` or `node index.js` to launch the bot. `npm test` is currently a placeholder that exits with an error, so do not rely on it as a real test suite. For lightweight checks, run targeted scripts such as `node test.js` or a purpose-built script under `commands/test`. When changing command registration, API services, config loading, or provider behavior, restart the bot to pick up the new code and configuration.

## Coding Style & Naming Conventions
Follow the existing CommonJS style with `require(...)`, `module.exports`, four-space indentation in legacy files, and single quotes where practical. Match the surrounding style when touching older files that already use two-space indentation or mixed quoting. Command classes should extend the same `twitch-commando` base types already used in the repo, and rate-limited chat commands should reuse `service/rateLimited.js` instead of reimplementing cooldown logic. Keep user-visible command names and aliases in the same language and format as the existing commands, including the leading `!` where applicable.

## Testing Guidelines
There is no formal automated test harness yet. Validate behavior by running the bot in a safe Twitch channel and exercising the affected commands directly. For streamer commands, verify both the command registration path in `commands/streamers/config.js` and the runtime response path through `service/twitchSvc.js` or `service/ytSvc.js`. If you add a helper that can be checked offline, create a small Node script for it and keep it near the existing ad-hoc test scripts.

## Commit & Pull Request Guidelines
The existing history uses short prefixed subjects such as `@Add`, `@fix`, and `@Update`; continue that pattern. Keep commit messages focused on the user-visible change or maintenance task. Pull requests should summarize behavior changes, list any new or renamed commands, and call out configuration or secret-handling changes. Include sample chat output when command behavior changes in a way that is easier to review from transcripts than code alone.

## Configuration & Secrets
Never commit real credentials. Copy `config.json.example` to `config.json` locally and fill in Twitch and YouTube settings there. If you add a new config key, update `config.json.example` in the same change. Be careful with API-related edits in `service/`, because this project mixes config-driven credentials with some hardcoded external endpoint behavior; avoid introducing additional hardcoded secrets and flag any existing secret exposure in review.
