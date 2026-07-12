'use strict';

const crypto = require('crypto');
const fsPromises = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REQUIRED_SCOPES = ['user:read:chat', 'user:write:chat'];
const DEFAULT_REDIRECT_URI = 'http://localhost';

function parseArgs(argv) {
  const options = {
    configPath: path.join(__dirname, '..', 'config.json'),
    redirectUri: DEFAULT_REDIRECT_URI
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--redirect-uri') {
      options.redirectUri = argv[++index];
    } else if (argument.startsWith('--redirect-uri=')) {
      options.redirectUri = argument.slice('--redirect-uri='.length);
    } else if (argument === '--config') {
      options.configPath = path.resolve(argv[++index]);
    } else if (argument.startsWith('--config=')) {
      options.configPath = path.resolve(argument.slice('--config='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.redirectUri) throw new Error('--redirect-uri requires a value.');
  return options;
}

function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
  url.searchParams.set('force_verify', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

function parseAuthorizationResponse(value, expectedState) {
  let callbackUrl;
  try {
    callbackUrl = new URL(String(value || '').trim());
  } catch (error) {
    throw new Error('請貼上瀏覽器網址列的完整 localhost URL。');
  }

  const returnedState = callbackUrl.searchParams.get('state');
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('OAuth state 不一致，請重新執行授權流程。');
  }

  const oauthError = callbackUrl.searchParams.get('error');
  if (oauthError) {
    const description = callbackUrl.searchParams.get('error_description') || oauthError;
    throw new Error(`Twitch 授權失敗：${description}`);
  }

  const code = callbackUrl.searchParams.get('code');
  if (!code) throw new Error('貼上的 URL 裡找不到 authorization code。');
  return code;
}

async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl = globalThis.fetch,
  tokenUrl = TOKEN_URL
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Twitch token 交換失敗：${data.message || response.statusText}`);
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Twitch 沒有同時回傳 access token 與 refresh token。');
  }

  const scopes = Array.isArray(data.scope) ? data.scope : [];
  const missingScopes = REQUIRED_SCOPES.filter(scope => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Twitch token 缺少 scopes：${missingScopes.join(', ')}`);
  }

  return data;
}

async function writeConfigAtomically(configPath, values) {
  const current = JSON.parse(await fsPromises.readFile(configPath, 'utf8'));
  const updated = { ...current, ...values };
  delete updated.oauth;

  const tempPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    await fsPromises.writeFile(tempPath, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await fsPromises.rename(tempPath, configPath);
    await fsPromises.chmod(configPath, 0o600);
  } catch (error) {
    await fsPromises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function promptText(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function promptSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('config.json 缺少 client_secret；請先填入或設定 TWITCH_CLIENT_SECRET。');
  }

  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let secret = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('已取消。'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(secret.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          secret = secret.slice(0, -1);
        } else {
          secret += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}


async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const configPath = path.resolve(options.configPath);
  const config = JSON.parse(await fsPromises.readFile(configPath, 'utf8'));
  await fsPromises.chmod(configPath, 0o600);

  const clientId = String(config.client_id || await promptText('Client ID: ')).trim();
  const clientSecret = String(
    config.client_secret || process.env.TWITCH_CLIENT_SECRET ||
    await promptSecret('Client Secret（輸入內容不會顯示）: ')
  ).trim();
  if (!clientId || !clientSecret) throw new Error('Client ID 與 Client Secret 都是必填。');

  const state = crypto.randomBytes(32).toString('hex');
  const authorizationUrl = buildAuthorizationUrl({
    clientId,
    redirectUri: options.redirectUri,
    state
  });

  console.log('\n請複製以下網址到瀏覽器開啟：\n%s\n', authorizationUrl);

  console.log('授權後即使 localhost 顯示無法連線也沒關係。');
  const callbackUrl = await promptText('請貼上瀏覽器網址列的完整 localhost URL: ');
  const code = parseAuthorizationResponse(callbackUrl, state);

  console.log('已收到授權，正在交換 token...');
  const tokenData = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code,
    redirectUri: options.redirectUri
  });
  await writeConfigAtomically(configPath, {
    client_id: clientId,
    client_secret: clientSecret,
    user_access_token: tokenData.access_token,
    user_refresh_token: tokenData.refresh_token
  });

  console.log('Token 已安全寫入 config.json（權限 0600）。');
  console.log('現在可以執行：npm start');
}

if (require.main === module) {
  main().catch(error => {
    console.error('OAuth 設定失敗：', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  main,
  parseArgs,
  parseAuthorizationResponse,
  writeConfigAtomically
};
