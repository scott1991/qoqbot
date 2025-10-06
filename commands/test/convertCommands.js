const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.js');

const stripComments = code => {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
};

const toSingleQuoted = value => {
    if (value === null || value === undefined) {
        return 'null';
    }

    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");

    return `'${escaped}'`;
};

const serializeAliases = aliases => {
    if (!Array.isArray(aliases) || aliases.length === 0) {
        return '[]';
    }

    const unique = Array.from(new Set(aliases.filter(Boolean)));
    return `[${unique.map(toSingleQuoted).join(', ')}]`;
};

const serializeConfig = entries => {
    const indent1 = '  ';
    const indent2 = '    ';
    const lines = ['module.exports = ['];

    entries.forEach((entry, idx) => {
        lines.push(`${indent1}{`);
        lines.push(`${indent2}displayName: ${toSingleQuoted(entry.displayName)},`);
        lines.push(`${indent2}command: ${toSingleQuoted(entry.command)},`);
        lines.push(`${indent2}aliases: ${serializeAliases(entry.aliases)},`);
        lines.push(`${indent2}youtubeChannelId: ${entry.youtubeChannelId ? toSingleQuoted(entry.youtubeChannelId) : 'null'},`);
        lines.push(`${indent2}twitchUsername: ${entry.twitchUsername ? toSingleQuoted(entry.twitchUsername) : 'null'}`);
        lines.push(`${indent1}}${idx === entries.length - 1 ? '' : ','}`);
    });

    lines.push('];');
    lines.push('');

    return lines.join('\n');
};

const extractCommandName = code => {
    const match = code.match(/name\s*:\s*(['\"])(.*?)\1/);
    return match ? match[2].trim() : null;
};

const extractAliases = code => {
    const match = code.match(/aliases\s*:\s*\[([\s\S]*?)\]/);
    if (!match) {
        return [];
    }

    const items = [];
    const aliasSection = match[1];
    const regex = /(['\"])(.*?)\1/g;
    let aliasMatch;

    while ((aliasMatch = regex.exec(aliasSection))) {
        const alias = aliasMatch[2].trim();
        if (alias) {
            items.push(alias);
        }
    }

    return items;
};

const extractServiceIdentifier = (code, pattern) => {
    const match = code.match(pattern);
    return match ? match[1].trim() : null;
};

const cleanDisplayName = raw => {
    if (!raw) {
        return null;
    }

    let name = raw.trim();

    name = name.replace(/[\s:：-]+$/g, '');
    name = name.replace(/(台|圖奇|YT|Youtube|YouTube)+$/gi, '');
    name = name.trim();

    return name || null;
};

const extractDisplayName = code => {
    const replyRegex = /msg\.reply\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;
    let match;

    while ((match = replyRegex.exec(code))) {
        const text = match[1] || match[2] || match[3];
        if (!text) {
            continue;
        }

        const idx = text.indexOf('現在');
        if (idx === -1) {
            continue;
        }

        const candidate = text.slice(0, idx);
        const name = cleanDisplayName(candidate);
        if (name) {
            return name;
        }
    }

    return null;
};

const normalizeFallbackName = value => {
    if (!value) {
        return null;
    }

    let name = value.trim();
    name = name.replace(/^!+/, '');
    name = name.replace(/人數$/g, '');
    name = name.replace(/(圖奇|YT)$/gi, '');
    return name.trim() || null;
};

const dedupeAliases = (aliases, command) => {
    const seen = new Set();
    const filtered = [];

    aliases.forEach(alias => {
        if (!alias || alias === command) {
            return;
        }
        if (!seen.has(alias)) {
            seen.add(alias);
            filtered.push(alias);
        }
    });

    return filtered;
};

const convertCommandFile = filePath => {
    const absolute = path.resolve(filePath);
    const raw = fs.readFileSync(absolute, 'utf8');
    const code = stripComments(raw);

    const command = extractCommandName(code);
    const aliases = extractAliases(code);
    const twitchUsername = extractServiceIdentifier(code, /twitchSvc\.getLiveViewersCountByName\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/);
    const youtubeChannelId = extractServiceIdentifier(code, /ytSvc\.getLiveInfoByChannelId\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/);

    let displayName = extractDisplayName(code);

    if (!displayName) {
        displayName = normalizeFallbackName(command);
    }

    if (!displayName && aliases.length > 0) {
        displayName = normalizeFallbackName(aliases[0]);
    }

    if (!displayName && twitchUsername) {
        displayName = twitchUsername;
    }

    if (!displayName && youtubeChannelId) {
        displayName = youtubeChannelId;
    }

    if (!displayName) {
        displayName = path.basename(filePath, path.extname(filePath));
    }

    const entry = {
        displayName,
        command: command || '',
        aliases: dedupeAliases(aliases, command),
        youtubeChannelId: youtubeChannelId || null,
        twitchUsername: twitchUsername || null
    };

    return entry;
};

const insertIntoConfig = (entry, options = {}) => {
    const configPath = options.configPath
        ? path.resolve(options.configPath)
        : DEFAULT_CONFIG_PATH;

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found at ${configPath}`);
    }

    delete require.cache[configPath];
    const currentConfig = require(configPath);
    const configEntries = Array.isArray(currentConfig) ? [...currentConfig] : [];

    const existingIndex = configEntries.findIndex(item => item.command === entry.command);

    if (existingIndex === -1) {
        configEntries.push(entry);
    } else {
        configEntries[existingIndex] = entry;
    }

    const serialized = serializeConfig(configEntries);
    fs.writeFileSync(configPath, serialized, 'utf8');

    return configEntries;
};

const collectTargetFiles = inputPaths => {
    const files = [];

    inputPaths.forEach(p => {
        const target = path.resolve(p);
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            fs.readdirSync(target)
                .filter(name => name.endsWith('.js'))
                .forEach(name => files.push(path.join(target, name)));
        } else if (stat.isFile()) {
            files.push(target);
        }
    });

    return files;
};

const printEntry = entry => {
    const serialized = serializeConfig([entry]).split('\n');
    console.log(serialized.slice(1, -2).join('\n'));
};

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: node convertCommands.js <fileOrDir> [more files...] [--write] [--config <path>]');
        process.exit(1);
    }

    const inputPaths = [];
    const options = { write: false, configPath: DEFAULT_CONFIG_PATH };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--write') {
            options.write = true;
            continue;
        }
        if (arg === '--config') {
            if (i + 1 >= args.length) {
                console.error('--config requires a path argument');
                process.exit(1);
            }
            options.configPath = path.resolve(args[i + 1]);
            i += 1;
            continue;
        }
        inputPaths.push(arg);
    }

    const files = collectTargetFiles(inputPaths);
    if (files.length === 0) {
        console.log('No command files found for the given input.');
        process.exit(1);
    }

    const entries = files.map(convertCommandFile);

    entries.forEach((entry, idx) => {
        console.log(`\n# Entry ${idx + 1}`);
        printEntry(entry);
    });

    if (options.write) {
        const configPath = options.configPath || DEFAULT_CONFIG_PATH;
        entries.forEach(entry => {
            insertIntoConfig(entry, { configPath });
        });
        console.log(`\nUpdated ${configPath} with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
    } else {
        console.log('\nRun with --write to update the config file.');
    }
}

module.exports = {
    convertCommandFile,
    insertIntoConfig
};
