# Repository Guidelines

## Project Structure & Module Organization
Source code lives at the root. `index.js` configures the Twitch Commando client and loads commands from `/commands`. Organise new command handlers under `/commands/<category>` next to existing Twitch (`streamers/twitch`) and YouTube (`streamers/yt`) examples. Shared helpers sit in `/service`, while persistence is handled by `/provider/JSONProvider.js` together with `database.json`. Place one-off experiments in `/commands/samples` or remove them before shipping.

## Build, Test, and Development Commands
Run `npm install` after cloning to sync dependencies. Use `npm start` (or `node index.js`) to launch the bot with the configured channels. For ad-hoc verifications, `node test.js` demonstrates how to exercise moment-based utilities; adapt it for quick checks. During development restart the process after editing configuration or provider logic.

## Coding Style & Naming Conventions
Follow the existing CommonJS style with four-space indentation and single quotes for strings. Export command classes via `module.exports` and name files after the command they register (e.g. `ViewerCommand.js`). Keep configuration-driven values in `config.json` and mirror the shape documented in `config.json.example`. Log output should stay at `warn` unless actively debugging.

## Testing Guidelines
There is no formal test harness, so validate changes by running the bot in a sandbox channel and exercising each affected command. Keep lightweight node scripts under `/commands/test` when you need repeatable checks, and delete them when obsolete. When adding new utilities, consider capturing reusable assertions in small helper scripts and reference them in review notes.

## Commit & Pull Request Guidelines
Commits typically start with scoped tags such as `@Add`, `@fix`, or `@Update`; continue that convention and keep messages to the point ("@Add viewer count command for new streamer"). Each pull request should describe the user-facing behaviour, list new commands or services, and call out configuration changes (OAuth tokens, channel IDs, cooldowns). Include screenshots or sample chat transcripts when behaviour is visual. Verify `config.json` is excluded from diffs before requesting review.

## Configuration & Secrets
Never commit real tokens. Copy `config.json.example` to `config.json`, then supply your OAuth and API keys locally. If you touch rate limits or provider settings, update the example file and note follow-up actions for operators. Reset the bot whenever credentials or channel lists change to ensure the JSON provider reloads correctly.
