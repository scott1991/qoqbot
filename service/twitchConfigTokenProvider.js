'use strict';

const fs = require('fs/promises');
const path = require('path');

class TwitchConfigTokenProvider {
  constructor({ configPath, config, normalizeAccessToken }) {
    this.configPath = configPath;
    this.normalizeAccessToken = normalizeAccessToken;
    this.tokenSet = {
      accessToken: normalizeAccessToken(config.user_access_token || config.oauth),
      refreshToken: String(config.user_refresh_token || '').trim() || undefined
    };
    this.writeQueue = Promise.resolve();
  }

  async secureFile() {
    await fs.chmod(this.configPath, 0o600);
  }

  async getToken() {
    return this.tokenSet;
  }

  async setToken(kind, tokenSet) {
    const previous = this.tokenSet;
    const next = {
      ...previous,
      ...tokenSet,
      accessToken: this.normalizeAccessToken(tokenSet.accessToken || previous.accessToken),
      refreshToken: String(tokenSet.refreshToken || previous.refreshToken || '').trim() || undefined
    };
    const tokensChanged = next.accessToken !== previous.accessToken ||
      next.refreshToken !== previous.refreshToken;

    if (!tokensChanged) {
      this.tokenSet = next;
      return;
    }

    const writePromise = this.writeQueue.then(() => this.persistTokens(next));
    this.writeQueue = writePromise.catch(() => {});
    await writePromise;
    this.tokenSet = next;
  }

  async persistTokens(tokenSet) {
    const rawConfig = await fs.readFile(this.configPath, 'utf8');
    const currentConfig = JSON.parse(rawConfig);
    const updatedConfig = {
      ...currentConfig,
      user_access_token: tokenSet.accessToken,
      user_refresh_token: tokenSet.refreshToken
    };
    delete updatedConfig.oauth;

    const tempPath = path.join(
      path.dirname(this.configPath),
      `.${path.basename(this.configPath)}.${process.pid}.${Date.now()}.tmp`
    );

    try {
      await fs.writeFile(tempPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
      await fs.rename(tempPath, this.configPath);
      await fs.chmod(this.configPath, 0o600);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}

module.exports = TwitchConfigTokenProvider;
