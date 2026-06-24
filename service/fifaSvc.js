const got = require('got');
const moment = require('moment');
const config = require('../config.json');

const SCORESHEET_URL = 'https://webapi.setn.com/api/event/getscoresheet/2';
const TAIWAN_UTC_OFFSET_MINUTES = 8 * 60;
const MATCHES_PER_MESSAGE = 4;
const DEFAULT_CACHE_SECONDS = 300;

let cachedScores = null;
let cachedAt = 0;

function getCacheSeconds() {
    const cacheSeconds = config.fifa && Number(config.fifa.cache_seconds);

    if (Number.isFinite(cacheSeconds) && cacheSeconds >= 0) {
        return cacheSeconds;
    }

    return DEFAULT_CACHE_SECONDS;
}

function getScoresFromBody(body) {
    if (Array.isArray(body)) {
        return body;
    }

    if (body && Array.isArray(body.data)) {
        return body.data;
    }

    return [];
}

async function fetchScores() {
    const cacheSeconds = getCacheSeconds();
    const now = Date.now();

    if (cacheSeconds > 0 && cachedScores && now - cachedAt < cacheSeconds * 1000) {
        return cachedScores;
    }

    const response = await got(SCORESHEET_URL, {
        responseType: 'json',
        timeout: {
            request: 10000
        }
    });

    cachedScores = getScoresFromBody(response.body);
    cachedAt = now;

    return cachedScores;
}

function getTaiwanMoment(value) {
    return moment(value).utcOffset(TAIWAN_UTC_OFFSET_MINUTES);
}

function getTargetDate(dayOffset, now) {
    return getTaiwanMoment(now || new Date()).add(dayOffset, 'days').format('YYYY/MM/DD');
}

function getMatchesByDay(scores, dayOffset, now) {
    const targetDate = getTargetDate(dayOffset, now);

    return scores
        .filter(score => {
            if (!score || !score.playStartTime) {
                return false;
            }

            return getTaiwanMoment(score.playStartTime).format('YYYY/MM/DD') === targetDate;
        })
        .sort((a, b) => new Date(a.playStartTime) - new Date(b.playStartTime));
}

function hasScore(score) {
    return score !== null && score !== undefined;
}

function formatScore(match) {
    if (hasScore(match.play1Score) && hasScore(match.play2Score)) {
        let text = match.play1Name + ' ' + match.play1Score + '-' + match.play2Score + ' ' + match.play2Name;

        if (hasScore(match.play1PKScore) && hasScore(match.play2PKScore)) {
            text += ' PK ' + match.play1PKScore + '-' + match.play2PKScore;
        }

        return text;
    }

    return match.play1Name + ' vs ' + match.play2Name;
}

function formatMatch(match) {
    const time = getTaiwanMoment(match.playStartTime).format('HH:mm');

    return time + ' ' + formatScore(match);
}

function chunk(items, size) {
    const chunks = [];

    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }

    return chunks;
}

function formatMessagesForDay(scores, dayOffset, now) {
    const targetDate = getTargetDate(dayOffset, now);
    const matches = getMatchesByDay(scores, dayOffset, now);

    if (matches.length === 0) {
        return [targetDate + ' 沒有 FIFA 賽程'];
    }

    const label = matches.every(match => match.ended) ? '賽果' : '賽程';

    return chunk(matches.map(formatMatch), MATCHES_PER_MESSAGE).map(matchesChunk => {
        return targetDate + ' ' + label + '：' + matchesChunk.join('｜');
    });
}

async function getMessagesForDay(dayOffset, now) {
    const scores = await fetchScores();

    return formatMessagesForDay(scores, dayOffset, now);
}

module.exports = {
    getMessagesForDay: getMessagesForDay,
    formatMessagesForDay: formatMessagesForDay,
    getMatchesByDay: getMatchesByDay,
    getTargetDate: getTargetDate
};
