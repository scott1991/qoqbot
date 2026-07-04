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

function stripHtmlTags(value) {
    return normalizeText(String(value || '').replace(/<[^>]*>/g, ' '));
}

function isBingDateText(value) {
    return /^\d{1,2}月\d{1,2}日/.test(value) || /^(昨天|今天|明天)$/.test(value);
}

function isBingTimeText(value) {
    return /^\d{1,2}:\d{2}$/.test(value);
}

function isBingLiveStatusText(value) {
    return /^(H\d|HT|ET)\b/i.test(value) || /^(上半場|下半場|中場|半場|加時|直播)/.test(value) || /\d+'\s*$/.test(value);
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

function parseBingPenaltyScores(cardHtml) {
    const penaltyScores = [];
    const scorePattern = /<div\b[^>]*\bclass=(["'])[^"']*\bbsp_team_scr\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/g;
    let match;

    while ((match = scorePattern.exec(String(cardHtml || ''))) !== null) {
        const penaltyMatch = match[2].match(/<span\b[^>]*\bclass=(["'])[^"']*\bbsp_pnlty_scr\b[^"']*\1[^>]*>\s*\((\d+)\)\s*<\/span>/);

        penaltyScores.push(penaltyMatch ? Number(penaltyMatch[2]) : null);
    }

    if (penaltyScores.length < 2 || !hasScore(penaltyScores[0]) || !hasScore(penaltyScores[1])) {
        return null;
    }

    return {
        play1PKScore: penaltyScores[0],
        play2PKScore: penaltyScores[1]
    };
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

function parseBingMatchLabel(label, now, fallbackDateText, cardHtml) {
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

    if (dateIndex === -1 && !fallbackDateText) {
        return null;
    }

    const dateText = dateIndex === -1 ? fallbackDateText : parts[dateIndex];
    const timeText = dateIndex !== -1 && isBingTimeText(parts[dateIndex + 1]) ? parts[dateIndex + 1] : '';
    const playStartTime = getBingMatchTaiwanTime(dateText, timeText, now);

    if (!playStartTime) {
        return null;
    }

    const scoreParts = dateIndex === -1 ? parts.slice(0, 2) : parts.slice(0, dateIndex);
    const statusText = dateIndex === -1 ? parts.slice(2).join(' ') : '';
    const isLive = isBingLiveStatusText(statusText);
    const play1Score = parseBingScorePart(scoreParts[0], play1Name);
    const play2Score = parseBingScorePart(scoreParts[1], play2Name);
    const hasScores = hasScore(play1Score) && hasScore(play2Score);
    const penaltyScores = parseBingPenaltyScores(cardHtml);

    return {
        playStartTime: playStartTime,
        play1Name: play1Name,
        play2Name: play2Name,
        play1Score: hasScores ? play1Score : undefined,
        play2Score: hasScores ? play2Score : undefined,
        play1PKScore: penaltyScores ? penaltyScores.play1PKScore : undefined,
        play2PKScore: penaltyScores ? penaltyScores.play2PKScore : undefined,
        stage: stage,
        matchStatus: isLive ? statusText : undefined,
        ended: hasScores && !isLive,
        hideTime: !timeText
    };
}

function parseBingScores(html, now) {
    const scores = [];
    const seen = {};
    const itemPattern = /<div\b[^>]*\bclass=(["'])[^"']*\bbsp-schedule-date-pivot\b[^"']*\1[^>]*>([\s\S]*?)<\/div>|\baria-label=(["'])(.*?)\3/g;
    let currentDateText = '';
    let match;

    while ((match = itemPattern.exec(String(html || ''))) !== null) {
        if (match[2]) {
            const dateText = stripHtmlTags(match[2]);

            if (isBingDateText(dateText)) {
                currentDateText = dateText;
            }

            continue;
        }

        const anchorStartIndex = String(html || '').lastIndexOf('<a ', match.index);
        const anchorEndIndex = String(html || '').indexOf('</a>', match.index);
        const cardHtml = anchorStartIndex !== -1 && anchorEndIndex !== -1 ? String(html || '').slice(anchorStartIndex, anchorEndIndex + 4) : '';
        const score = parseBingMatchLabel(match[4], now, currentDateText, cardHtml);

        if (!score) {
            continue;
        }

        const key = [
            score.playStartTime,
            score.play1Name,
            score.play2Name,
            score.play1Score,
            score.play2Score,
            score.play1PKScore,
            score.play2PKScore
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
    if (match.matchStatus && !match.ended) {
        return normalizeText(match.matchStatus.replace(/\s*·\s*/g, ' ')) + ' ' + formatScore(match);
    }

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
