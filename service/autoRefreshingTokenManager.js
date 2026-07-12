'use strict';

const { TokenManager } = require('qoq-commando');

class AutoRefreshingTokenManager extends TokenManager {
  constructor(options = {}) {
    super(options);
    this.tokenProvider = options.tokenProvider;
    this.logger = options.logger || console;
    this.refreshSkewMs = options.refreshSkewMs || 5 * 60 * 1000;
    this.refreshPromise = null;
    this.refreshTimer = null;
  }

  async validate(kind = 'user') {
    try {
      const validation = await super.validate(kind);
      await this.recordExpiry(kind, validation.expires_in);
      return validation;
    } catch (error) {
      if (!/^Twitch token validation failed:/.test(error.message)) throw error;

      this.logger.warn('Twitch access token is invalid or expired; refreshing it.');
      await this.refreshUserToken();
      const validation = await super.validate(kind);
      await this.recordExpiry(kind, validation.expires_in);
      return validation;
    }
  }

  async getUserAccessToken(requiredScopes = []) {
    await this.ensureFresh();
    return super.getUserAccessToken(requiredScopes);
  }

  async getAppAccessToken(requiredScopes = []) {
    await this.ensureFresh();
    return super.getAppAccessToken(requiredScopes);
  }

  async refreshUserToken() {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const updated = await super.refreshUserToken();
      updated.expiresAt = this.expiresAtFrom(updated.expiresIn);
      await this.tokenProvider.setToken('user', updated);
      this.scheduleRefresh(updated.expiresIn);
      this.logger.info('Twitch access token refreshed and saved securely.');
      return updated;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async ensureFresh() {
    const tokenSet = await this.tokenProvider.getToken('user');
    if (!tokenSet || !tokenSet.expiresAt) return;

    if (tokenSet.expiresAt <= Date.now() + this.refreshSkewMs) {
      await this.refreshUserToken();
    }
  }

  async recordExpiry(kind, expiresIn) {
    if (!Number.isFinite(Number(expiresIn))) return;
    const tokenSet = await this.tokenProvider.getToken(kind);
    tokenSet.expiresAt = this.expiresAtFrom(expiresIn);
    await this.tokenProvider.setToken(kind, tokenSet);
    this.scheduleRefresh(expiresIn);
  }

  scheduleRefresh(expiresIn) {
    const expiresInMs = Number(expiresIn) * 1000;
    if (!Number.isFinite(expiresInMs)) return;

    this.clearRefreshTimer();
    const delayMs = Math.max(1000, expiresInMs - this.refreshSkewMs);
    this.refreshTimer = setTimeout(() => this.runScheduledRefresh(), delayMs);
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }

  async runScheduledRefresh() {
    this.refreshTimer = null;
    try {
      await this.refreshUserToken();
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error('Scheduled Twitch token refresh failed; retrying in 60 seconds.');
      }
      this.refreshTimer = setTimeout(() => this.runScheduledRefresh(), 60 * 1000);
      if (this.refreshTimer.unref) this.refreshTimer.unref();
    }
  }

  clearRefreshTimer() {
    if (!this.refreshTimer) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  expiresAtFrom(expiresIn) {
    return Date.now() + Number(expiresIn || 0) * 1000;
  }
}

module.exports = AutoRefreshingTokenManager;
