const got = require('got');
const moment = require('moment');
const config = require('../config.json');

const SCORESHEET_URL = 'https://webapi.setn.com/api/event/getscoresheet/2';
const BING_SCORES_BASE_URL = 'https://www.bing.com/bingsportstab';
const TAIWAN_UTC_OFFSET_MINUTES = 8 * 60;
const MATCHES_PER_MESSAGE = 4;
const DEFAULT_CACHE_SECONDS = 300;
const DEFAULT_BING_SEASON_YEAR = 2026;

let cachedScores = null;
let cachedAt = 0;
let cachedBingScores = null;
let cachedBingAt = 0;

function getCacheSeconds() {
    const cacheSeconds = config.fifa && Number(config.fifa.cache_seconds);

    if (Number.isFinite(cacheSeconds) && cacheSeconds >= 0) {
        return cacheSeconds;
    }

    return DEFAULT_CACHE_SECONDS;
}

function getBingSeasonYear() {
    const seasonYear = config.fifa && Number(config.fifa.season_year);

    if (Number.isFinite(seasonYear) && seasonYear > 0) {
        return seasonYear;
    }

    return DEFAULT_BING_SEASON_YEAR;
}

function buildBingScoresUrl() {
    if (config.fifa && config.fifa.bing_url) {
        return config.fifa.bing_url;
    }

    const params = new URLSearchParams({
        q: '',
        sport: 'Soccer',
        scenario: 'League',
        TimezoneId: 'Taipei Standard Time',
        IANATimezoneId: 'Asia/Taipei',
        ISOTimezoneKey: 'CST',
        league: 'Soccer_InternationalWorldCup',
        intent: 'Generic',
        seasonyear: String(getBingSeasonYear()),
        segment: 'sports',
        isl2: 'true',
        isajax: 'true',
        TopAjaxTabReq: 'true',
        IsInfiniteScrollAjax: 'true'
    });

    return BING_SCORES_BASE_URL + '?' + params.toString();
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

function decodeHtml(value) {
    const entities = {
        amp: '&',
        quot: '"',
        apos: '\'',
        lt: '<',
        gt: '>'
    };

    return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
        if (entity.charAt(0) === '#') {
            const isHex = entity.charAt(1).toLowerCase() === 'x';
            const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);

            if (Number.isFinite(code)) {
                return String.fromCodePoint(code);
            }
        }

        return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match;
    });
}

function normalizeText(value) {
    return decodeHtml(value).replace(/\s+/g, ' ').trim();
}

function isBingDateText(value) {
    return /^\d{1,2}月\d{1,2}日/.test(value) || /^(昨天|今天|明天)$/.test(value);
}

function isBingTimeText(value) {
    return /^\d{1,2}:\d{2}$/.test(value);
}

function parseBingScorePart(value, teamName) {
    const text = normalizeText(value);
    const prefix = teamName + ' ';

    if (text.indexOf(prefix) !== 0) {
        return null;
    }

    const score = Number(text.slice(prefix.length).trim());

    return Number.isFinite(score) ? score : null;
}

function getBingMatchTaiwanTime(dateText, timeText, now) {
    const normalizedDateText = normalizeText(dateText);
    const relativeDayOffsets = {
        '昨天': -1,
        '今天': 0,
        '明天': 1
    };
    const time = isBingTimeText(timeText) ? timeText : '00:00';

    if (Object.prototype.hasOwnProperty.call(relativeDayOffsets, normalizedDateText)) {
        return getCurrentTaiwanMoment(now || new Date())
            .add(relativeDayOffsets[normalizedDateText], 'days')
            .format('YYYY-MM-DD') + 'T' + time + ':00+08:00';
    }

    const dateMatch = normalizedDateText.match(/(\d{1,2})月(\d{1,2})日/);

    if (!dateMatch) {
        return null;
    }

    return moment.parseZone(
        getBingSeasonYear() + '-' +
        String(Number(dateMatch[1])).padStart(2, '0') + '-' +
        String(Number(dateMatch[2])).padStart(2, '0') + 'T' +
        time + ':00+08:00'
    ).format();
}

function parseBingMatchLabel(label, now) {
    const text = normalizeText(label);
    const match = text.match(/^查看有關 (.+?) 對決 (.+?) 的詳細資料, (.+)$/);

    if (!match) {
        return null;
    }

    const play1Name = match[1];
    const play2Name = match[2];
    const parts = match[3].split(',').map(normalizeText).filter(Boolean);
    const stage = parts.shift() || '';
    const dateIndex = parts.findIndex(isBingDateText);

    if (dateIndex === -1) {
        return null;
    }

    const dateText = parts[dateIndex];
    const timeText = isBingTimeText(parts[dateIndex + 1]) ? parts[dateIndex + 1] : '';
    const playStartTime = getBingMatchTaiwanTime(dateText, timeText, now);

    if (!playStartTime) {
        return null;
    }

    const scoreParts = parts.slice(0, dateIndex);
    const play1Score = parseBingScorePart(scoreParts[0], play1Name);
    const play2Score = parseBingScorePart(scoreParts[1], play2Name);
    const hasScores = hasScore(play1Score) && hasScore(play2Score);

    return {
        playStartTime: playStartTime,
        play1Name: play1Name,
        play2Name: play2Name,
        play1Score: hasScores ? play1Score : undefined,
        play2Score: hasScores ? play2Score : undefined,
        stage: stage,
        ended: hasScores,
        hideTime: !timeText
    };
}

function parseBingScores(html, now) {
    const scores = [];
    const seen = {};
    const ariaLabelPattern = /\baria-label=(["'])(.*?)\1/g;
    let match;

    while ((match = ariaLabelPattern.exec(String(html || ''))) !== null) {
        const score = parseBingMatchLabel(match[2], now);

        if (!score) {
            continue;
        }

        const key = [
            score.playStartTime,
            score.play1Name,
            score.play2Name,
            score.play1Score,
            score.play2Score
        ].join('|');

        if (!seen[key]) {
            seen[key] = true;
            scores.push(score);
        }
    }

    return scores.sort((a, b) => getMatchTaiwanMoment(a.playStartTime).valueOf() - getMatchTaiwanMoment(b.playStartTime).valueOf());
}

async function fetchBingScores() {
    const cacheSeconds = getCacheSeconds();
    const now = Date.now();

    if (cacheSeconds > 0 && cachedBingScores && now - cachedBingAt < cacheSeconds * 1000) {
        return cachedBingScores;
    }

    const response = await got(buildBingScoresUrl(), {
        headers: {
            'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'user-agent': 'Mozilla/5.0 qoqbot/1.0'
        },
        timeout: {
            request: 10000
        }
    });
    const scores = parseBingScores(response.body, now);

    if (scores.length === 0) {
        throw new Error('No FIFA matches parsed from Bing sports response');
    }

    cachedBingScores = scores;
    cachedBingAt = now;

    return cachedBingScores;
}

async function fetchCurrentScores() {
    if (config.fifa && config.fifa.source === 'setn') {
        return fetchScores();
    }

    try {
        return await fetchBingScores();
    } catch (e) {
        if (config.fifa && config.fifa.fallback_to_setn === false) {
            throw e;
        }

        return fetchScores();
    }
}

function getCurrentTaiwanMoment(value) {
    return moment(value).utcOffset(TAIWAN_UTC_OFFSET_MINUTES);
}

function getMatchTaiwanMoment(value) {
    const text = String(value || '');

    // SETN appends Z, but these score sheet times are Taiwan local wall time.
    if (text.endsWith('Z')) {
        return moment.parseZone(text.slice(0, -1) + '+08:00');
    }

    return moment(value).utcOffset(TAIWAN_UTC_OFFSET_MINUTES);
}

function getTargetDate(dayOffset, now) {
    return getCurrentTaiwanMoment(now || new Date()).add(dayOffset, 'days').format('YYYY/MM/DD');
}

function getMatchesByDay(scores, dayOffset, now) {
    const targetDate = getTargetDate(dayOffset, now);

    return scores
        .filter(score => {
            if (!score || !score.playStartTime) {
                return false;
            }

            return getMatchTaiwanMoment(score.playStartTime).format('YYYY/MM/DD') === targetDate;
        })
        .sort((a, b) => getMatchTaiwanMoment(a.playStartTime).valueOf() - getMatchTaiwanMoment(b.playStartTime).valueOf());
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
    if (match.hideTime) {
        return formatScore(match);
    }

    return getMatchTaiwanMoment(match.playStartTime).format('HH:mm') + ' ' + formatScore(match);
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
    const scores = await fetchCurrentScores();

    return formatMessagesForDay(scores, dayOffset, now);
}

module.exports = {
    getMessagesForDay: getMessagesForDay,
    formatMessagesForDay: formatMessagesForDay,
    getMatchesByDay: getMatchesByDay,
    getTargetDate: getTargetDate,
    fetchScores: fetchScores,
    fetchBingScores: fetchBingScores,
    parseBingScores: parseBingScores,
    parseBingMatchLabel: parseBingMatchLabel
};
