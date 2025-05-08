const fs = require('fs');

class JSONProvider {
    constructor(filePath) {
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

    get(key, defaultValue = null) {
        return this.data[key] || defaultValue;
    }

    set(key, value) {
        this.data[key] = value;
        this._save();
    }

    delete(key) {
        delete this.data[key];
        this._save();
    }

    clear() {
        this.data = {};
        this._save();
    }
}

module.exports = JSONProvider;