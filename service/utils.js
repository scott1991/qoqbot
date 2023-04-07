function checkRateLimit(user, command, rateLimit) {
    const now = Date.now();
    const timestamps = commandTimestamps.get(user.id) || new Map();
    const lastTimestamp = timestamps.get(command) || 0;
  
    if (lastTimestamp && now - lastTimestamp < rateLimit) {
      return false; // The user is within the rate limit, so the command is blocked.
    }
  
    timestamps.set(command, now);
    commandTimestamps.set(user.id, timestamps);
    return true; // The user is not within the rate limit, so the command is allowed.
  }

  function getRandomInt(max) {
    return Math.floor(Math.random() * max);
  }

  module.exports = {
    checkRateLimit:checkRateLimit,
    getRandomInt:getRandomInt
  }