const fs = require('fs');
const { SettingsProvider } = require('twitch-commando');

class JSONProvider extends SettingsProvider {
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.data = {};
    }

    async init(client) {
        this.client = client;
        if (fs.existsSync(this.filePath)) {
            const fileContent = fs.readFileSync(this.filePath, 'utf8');
            this.data = JSON.parse(fileContent);
        }
    }

    _save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 4));
    }

    async get(channel, key, defaultValue = null) {
        if (this.data[channel] && this.data[channel][key] !== undefined) {
            return this.data[channel][key];
        }
        return defaultValue;
    }

    async set(channel, key, value) {
        if (!this.data[channel]) {
            this.data[channel] = {};
        }
        this.data[channel][key] = value;
        this._save();
    }

    async remove(channel, key) {
        if (this.data[channel] && this.data[channel][key] !== undefined) {
            delete this.data[channel][key];
            if (Object.keys(this.data[channel]).length === 0) {
                delete this.data[channel];
            }
            this._save();
        }
    }

    async clear() {
        this.data = {};
        this._save();
    }
}

module.exports = JSONProvider;