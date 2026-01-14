# GEMINI.md - qoqbot

## Project Overview

`qoqbot` is a Twitch chat bot built with Node.js and the `twitch-commando` framework. Its primary function is to provide commands for querying information about Twitch and YouTube streamers, such as live viewer counts and the time of their last stream. The bot is designed to be easily customizable, with commands stored in separate, easily editable script files.

## Key Technologies

*   **Node.js:** The runtime environment for the bot.
*   **twitch-commando:** A command framework for Twitch bots, providing a structured way to create and manage commands.
*   **got:** A lightweight HTTP request library used for making API calls to Twitch and YouTube.
*   **moment.js:** A library for parsing, validating, manipulating, and formatting dates and times.

## Project Structure

The project is organized into several key directories:

*   `index.js`: The main entry point of the application. It initializes the `TwitchCommandoClient`, registers commands, and connects to Twitch.
*   `commands/`: This directory contains all the chat commands, which are organized into subdirectories based on their functionality.
    *   `streamers/`: Contains commands related to fetching streamer information. `ViewerCommand.js` is a generic command that is dynamically configured for different streamers.
*   `service/`: This directory holds services that interact with external APIs.
    *   `twitchSvc.js`: Handles interactions with the Twitch API, including fetching stream data.
    *   `ytSvc.js`: Manages interactions with the YouTube API to get live stream information.
*   `provider/`: Contains the `JSONProvider.js`, which is used for simple data persistence, storing data in a `database.json` file.
*   `config.json.example`: An example configuration file. A `config.json` file must be created from this template with the appropriate API keys and tokens.

## Building and Running

To get the bot up and running, follow these steps:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Configure the Bot:**
    *   Copy the `config.json.example` file and rename it to `config.json`.
    *   Edit `config.json` to add your Twitch OAuth token, YouTube API key, and other necessary values.

3.  **Run the Bot:**
    ```bash
    npm start
    ```
    Alternatively, you can run the main script directly:
    ```bash
    node index.js
    ```

## Development Conventions

*   **Command Structure:** Commands are defined as classes that extend `RateLimitedTwitchChatCommand` or `TwitchChatCommand` from the `twitch-commando` library. Each command is in its own file within the `commands` directory.
*   **API Interaction:** All interactions with external APIs (Twitch, YouTube) are handled by dedicated services in the `service` directory. This separation of concerns makes the code easier to maintain and test.
*   **Configuration:** Streamer-specific configurations for commands are stored in `commands/streamers/config.js`, allowing for easy addition or modification of streamer commands without changing the core command logic.
*   **Rate Limiting:** The bot implements a rate-limiting mechanism to prevent API abuse, as seen in `service/rateLimited.js`.
