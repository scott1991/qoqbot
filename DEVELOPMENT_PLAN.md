# Development Plan: qoq-commando - A Lightweight Twitch Bot Framework

## 1. Overview

This document outlines the development plan for `qoq-commando`, a lightweight Twitch chat bot framework. The framework will replace the `twitch-commando` dependency in the `qoqbot` project, removing the need for `sqlite` and the built-in `SettingsProvider`. It will be designed to support the existing features of `qoqbot`, including custom rate-limiting and dynamic command generation.

## 2. Project Goals

*   Create a standalone Node.js package for the bot framework.
*   Replicate the core command-handling functionality of `twitch-commando`.
*   Remove the dependency on `sqlite` and the `SettingsProvider`.
*   Provide a simple, file-based data persistence solution as an optional component.
*   Ensure the framework is compatible with the existing command structure of `qoqbot`.

## 3. Phases of Development

### Phase 1: Core Framework Implementation

This phase focuses on building the essential components of the framework.

#### 3.1. Project Scaffolding

Create the following directory structure for the new package:

```
qoq-commando/
├── src/
│   ├── client.js         # Core client class
│   ├── command.js        # Base command class
│   └── commandRegistry.js # Command registration and management
└── index.js              # Package entry point
```

#### 3.2. `src/client.js`: `QoqCommandoClient`

This class will be the main entry point for the framework.

*   **Dependencies**: `tmi.js`
*   **Constructor**: `constructor(options)`
    *   Accepts `options` object with `username`, `oauth`, `channels`, `prefix`.
    *   Initializes a `tmi.js` client.
    *   Initializes a `CommandRegistry`.
*   **Methods**:
    *   `connect()`: Connects the `tmi.js` client to Twitch.
    *   `onMessageHandler(channel, userstate, message, self)`:
        *   Bound to the `tmi.js` `message` event.
        *   Parses the message to identify the command and arguments.
        *   Looks up the command in the `CommandRegistry`.
        *   If a command is found, execute its `run` method, passing a `msg` object.
    *   `registerCommand(commandClass)`: Registers a single command class.
    *   `registerCommandsIn(directory)`: Loads and registers all command files from a given directory.
    *   `say(channel, message)`: A convenience method to send a message to a channel.

#### 3.3. `src/command.js`: `QoqCommand`

This will be the base class that all commands extend.

*   **Constructor**: `constructor(client, options)`
    *   Accepts the client instance and an `options` object.
    *   The `options` object will contain metadata like `name`, `aliases`, `group`, `description`.
*   **Methods**:
    *   `run(msg, args)`: The main logic of the command. This method must be overridden by subclasses.

#### 3.4. `src/commandRegistry.js`: `CommandRegistry`

This class will manage the collection of commands.

*   **Constructor**: `constructor()`
    *   Initializes an array or map to store commands.
*   **Methods**:
    *   `register(command)`: Adds a command instance to the registry.
    *   `find(commandName)`: Finds a command by its name or alias.

### Phase 2: Advanced Feature Implementation

This phase adds features required by `qoqbot`'s existing commands.

#### 3.5. Rate Limiting

The `RateLimitedTwitchChatCommand` will be implemented as a new base class that extends `QoqCommand`.

*   **`RateLimitedQoqCommand`**:
    *   Extends `QoqCommand`.
    *   Adds `rateLimit` and `lastCommandTimestamp` properties.
    *   Overrides the `run` method to check the rate limit before executing the command's logic.
    *   Introduces a new method, `delayRun(msg, args)`, which subclasses will implement for their logic.

#### 3.6. Dynamic Command Generation

The framework must support the pattern used in `ViewerCommand.js`.

*   The `registerCommand` method in `QoqCommandoClient` will be the primary way to add dynamically created commands.
*   The implementation should ensure that the client's command collection can be modified at runtime.

#### 3.7. Simple JSON-based Persistence

A simple, optional JSON provider can be created, mimicking the existing `JSONProvider.js`.

*   **`JSONProvider`**:
    *   A class with `get(key, defaultValue)` and `set(key, value)` methods.
    *   It will read from and write to a JSON file.
    *   The `QoqCommandoClient` can have an optional `setProvider(provider)` method to make the provider available to commands.

### Phase 3: Integration and Refactoring in `qoqbot`

This phase details the steps to replace `twitch-commando` in the `qoqbot` project.

#### 3.8. Update `package.json`

*   Remove `"twitch-commando": "github:scott1991/twitch-commando"`.
*   Add the new `qoq-commando` package (e.g., as a local dependency).

#### 3.9. Refactor `index.js`

*   Replace `const { TwitchCommandoClient } = require('twitch-commando');` with `const { QoqCommandoClient } = require('qoq-commando');`.
*   Update the client instantiation to use `QoqCommandoClient`.
*   Remove the `setProvider` logic if the new persistence provider is not used.
*   The `registerDetaultCommands` method will be removed, as it's not part of the new framework.

#### 3.10. Refactor Command Files

*   In all command files (e.g., `commands/querys/followTime.js`), replace `const { TwitchChatCommand } = require('twitch-commando');` with `const { QoqCommand } = require('qoq-commando');`.
*   In `service/rateLimited.js`, the `RateLimitedTwitchChatCommand` should be updated to extend `QoqCommand`.
*   Update any usage of the `msg` object to match the structure provided by `QoqCommandoClient`.

By following this plan, a developer can create a new, lightweight framework tailored to the needs of `qoqbot` and then integrate it into the project, successfully removing the `twitch-commando` dependency.
