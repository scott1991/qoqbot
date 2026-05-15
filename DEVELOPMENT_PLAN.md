# Development Plan: qoq-commando - EventSub + Helix Chat Framework (CURRENTLY PENDING)

## 1. Overview

This document outlines the development plan for `qoq-commando`, a lightweight Twitch chat bot framework that replaces the `twitch-commando` dependency in `qoqbot`.

The upgraded version intentionally does **not** use `tmi.js` or IRC as the primary chat transport. Instead, it adopts Twitch's modern chatbot architecture:

* Event intake via **EventSub** (WebSocket first, Webhook optional).
* Message sending via **Helix Send Chat Message API**.
* OAuth token lifecycle management for app/user tokens.

The framework remains compatible with `qoqbot` command patterns (rate limiting, dynamic command generation) while removing the dependency on `sqlite` and built-in `SettingsProvider`.

## 2. Project Goals

* Create a standalone Node.js package for the bot framework.
* Replicate the core command-handling UX from `twitch-commando` for existing commands.
* Remove `tmi.js` and IRC coupling from the framework core.
* Adopt EventSub + Helix as the default chat architecture.
* Remove dependency on `sqlite` and `SettingsProvider`.
* Provide optional file-based persistence and token cache helpers.
* Ensure compatibility with the existing command structure of `qoqbot`.

## 3. Target Architecture

### 3.1 Transport and Auth Model

* **Inbound chat events**: EventSub subscriptions (channel chat message + other required event types).
* **Outbound chat messages**: Helix API (`/chat/messages`).
* **Auth**:
    * App Access Token for EventSub management operations.
    * User Access Token for chat send operations and user-context scopes.
* **Token lifecycle**:
    * Validation on startup.
    * Refresh flow for expiring tokens.
    * Clear error mapping for missing scopes / revoked tokens.

### 3.2 High-level Components

```
qoq-commando/
├── src/
│   ├── client.js               # QoqCommandoClient (orchestration)
│   ├── command.js              # Base command class
│   ├── commandRegistry.js      # Command registration and lookup
│   ├── eventsubGateway.js      # EventSub WS/webhook session + handlers
│   ├── helixChatApi.js         # Send Chat Message + Helix wrappers
│   ├── auth/
│   │   ├── tokenManager.js     # token validate/refresh/cache
│   │   └── scopeGuard.js       # required scope checks
│   └── adapters/
│       └── messageContext.js   # normalize EventSub payload -> msg object
└── index.js                    # Package entry point
```

## 4. Phases of Development

### Phase 1: Core Framework Implementation

#### 4.1 Project Scaffolding

Create the package structure shown above and initialize lint/test tooling.

#### 4.2 `src/client.js`: `QoqCommandoClient`

Main entry point for framework users.

* **Dependencies**: native `fetch`/HTTP client, EventSub gateway, Helix chat API module.
* **Constructor**: `constructor(options)`
    * Accepts `options` including identity, broadcaster/channel IDs, prefix, token provider.
    * Initializes `CommandRegistry`, `TokenManager`, `EventSubGateway`, and `HelixChatApi`.
* **Methods**:
    * `connect()`:
        * Validates tokens/scopes.
        * Starts EventSub connection (WS default).
        * Ensures required subscriptions exist.
    * `onEventSubMessage(event)`:
        * Converts EventSub payload into internal `msg` object.
        * Runs command parsing + dispatch pipeline.
    * `registerCommand(commandClass)` and `registerCommandsIn(directory)`.
    * `say(channel, text, options)`:
        * Resolves broadcaster/sender IDs.
        * Calls Helix Send Chat Message endpoint.

#### 4.3 `src/command.js`: `QoqCommand`

Base class for commands.

* **Constructor**: `constructor(client, options)`
    * Maintains metadata: `name`, `aliases`, `group`, `description`.
* **Methods**:
    * `run(msg, args)`: to be implemented by subclasses.

#### 4.4 `src/commandRegistry.js`: `CommandRegistry`

Command collection and lookup.

* `register(command)`
* `find(commandName)`
* Alias collision checks and startup warnings.

#### 4.5 `src/adapters/messageContext.js`

Normalizes EventSub event payloads into a stable command context.

* Normalize fields such as `username`, `userId`, `channel`, `messageText`, timestamp, badges/mod flags.
* Preserve compatibility for existing command expectations where possible.

### Phase 2: EventSub + Helix Infrastructure

#### 4.6 `src/eventsubGateway.js`

* Support WebSocket session handling (welcome, keepalive, reconnect, revocation).
* Subscription bootstrap and reconciliation.
* Event routing only for required event types (chat message first).
* Idempotent delivery handling and retry-safe processing.

#### 4.7 `src/helixChatApi.js`

* Encapsulate Helix chat-send endpoint and future chat endpoints.
* Centralized rate-limit/backoff handling for Helix responses.
* Error translation into developer-friendly framework errors.

#### 4.8 `src/auth/tokenManager.js` + `scopeGuard.js`

* Validate tokens at startup.
* Refresh and persist tokens via pluggable storage callback.
* Required scope declarations per feature.
* Runtime guardrails with actionable errors.

### Phase 3: Compatibility Features for `qoqbot`

#### 4.9 Rate Limiting

Implement `RateLimitedQoqCommand` extending `QoqCommand`.

* Preserve `delayRun(msg, args)` style used by existing project patterns.
* Keep behavior aligned with current `service/rateLimited.js` semantics.

#### 4.10 Dynamic Command Generation

* Keep runtime registration APIs for `ViewerCommand.js` style command generation.
* Ensure dynamic command updates are safe while the EventSub session is active.

#### 4.11 Optional JSON Persistence

* Provide lightweight JSON provider similar to current provider behavior.
* Keep provider optional and independent from command dispatch core.

### Phase 4: Integration and Refactoring in `qoqbot`

#### 4.12 Update `package.json`

* Remove `twitch-commando` dependency.
* Add `qoq-commando` package reference.

#### 4.13 Refactor `index.js`

* Replace `TwitchCommandoClient` with `QoqCommandoClient`.
* Move from IRC credential config (`username` + `oauth`) to EventSub/Helix config set:
    * app client id/secret handling
    * user token + refresh token
    * broadcaster/user IDs
* Keep ignored-user filtering and AI responder hooks with the new message context.

#### 4.14 Refactor Command Files

* Replace `TwitchChatCommand` imports with `QoqCommand` (or `RateLimitedQoqCommand`).
* Update command `msg` assumptions to new normalized context fields.

## 5. Milestones and Acceptance Criteria

### M1: Minimal Chat Loop (EventSub -> command -> Helix reply)

* Bot receives channel chat messages via EventSub.
* A simple `!ping` style command executes and responds via Helix.

### M2: Command Parity for Existing qoqbot Commands

* Existing query/streamer commands run under new framework with no user-visible command name changes.
* Rate-limited commands behave as before.

### M3: Operational Hardening

* Token refresh and EventSub reconnect paths validated.
* Startup diagnostics clearly report missing scopes, invalid IDs, or auth failures.

## 6. Migration Notes

* Initial rollout should support a staged migration (old bot and new bot in separate test channels).
* Avoid enabling both frameworks in the same process for production channels during early migration.
* Add runbook docs for token rotation and EventSub subscription troubleshooting.

By following this plan, the team can build a modern `qoq-commando` framework aligned with Twitch's EventSub + Helix direction while preserving `qoqbot`'s command-centric developer experience.
