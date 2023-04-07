const { yt_api_key } = require('../config.json');
const got = require('got');

const rootURL = 'https://youtube.googleapis.com/youtube/v3/';

function getChannelLiveVideoId(channelId) {
  return got('search', {
    prefixUrl: rootURL,
    searchParams: {
      part: 'id',
      channelId: channelId,
      eventType: 'live',
      type: 'video',
      fields: 'items',
      key: yt_api_key
    },
    responseType: 'json'
  });
}
/*
channelId can use : document.querySelector('[itemprop="channelId"]').getAttribute('content')

not found:
body: {
  "items": []
}

found:
body:{
  "items": [
    {
      "kind": "youtube#searchResult",
      "etag": "MLe5RrIKGeKqIUEUJGQJtnXEyNA",
      "id": {
        "kind": "youtube#video",
        "videoId": "60x6sJ0ZZV8"
      }
    }
  ]
}
*/
function getLastLiveVideoIdByChannelId(channelId) {
  return got('search', {
    prefixUrl: rootURL,
    searchParams: {
      key: yt_api_key,
      part: 'id',
      channelId: channelId,
      eventType: 'completed',
      type: 'video',
      fields: 'items',
      order: 'date',
      maxResults: 1
    },
    responseType: 'json'
  });
}
/*
{
  "items": [
    {
      "kind": "youtube#searchResult",
      "etag": "VHu3ukvGVlOKtrKAHSUSbOvOxfc",
      "id": {
        "kind": "youtube#video",
        "videoId": "vyDGqd9bylI"
      }
    }
  ]
}

*/

function getLiveDetailsByVideoId(videoId) {
  return got('videos', {
    prefixUrl: rootURL,
    searchParams: {
      key: yt_api_key,
      part: 'liveStreamingDetails',
      id: videoId,
      fields: 'items',
    },
    responseType: 'json'
  });
}
/*
is live:
{
  "items": [
    {
      "kind": "youtube#video",
      "etag": "EYfVZFYKnSNwR-SgsYAUpr-xzKg",
      "id": "60x6sJ0ZZV8",
      "liveStreamingDetails": {
        "actualStartTime": "2023-03-31T15:27:16Z",
        "scheduledStartTime": "2023-03-31T15:30:00Z",
        "concurrentViewers": "10531",
        "activeLiveChatId": "Cg0KCzYweDZzSjBaWlY4KicKGFVDMXV2Mk9xNmtOeGdBVGxDaWV6NTlodxILNjB4NnNKMFpaVjg"
      }
    }
  ]
}

is not live:
{
  "items": [
    {
      "kind": "youtube#video",
      "etag": "mNi-z2dDYrWr7KGrebSyWs_coVQ",
      "id": "60x6sJ0ZZV8",
      "liveStreamingDetails": {
        "actualStartTime": "2023-03-31T15:27:16Z",
        "actualEndTime": "2023-03-31T18:14:15Z",
        "scheduledStartTime": "2023-03-31T15:30:00Z"
      }
    }
  ]
}
*/

async function getLiveInfoByChannelId(channelId) {
  let info = {
    currentViewers: 0,
    actualEndTime: null
  }
  try {
    const liveVideoResponse = await getChannelLiveVideoId(channelId);

    if (liveVideoResponse.body.items.length > 0) { // isLive
      const liveVideoId = liveVideoResponse.body.items[0].id.videoId;
      // const liveDetailsResponse = await getLiveDetailsByVideoId(liveVideoId);
      const liveDetailsResponse = await getLiveDetailsByVideoId_NOAPI(liveVideoId);

      if (liveDetailsResponse.body.items.length > 0) {
        const currentViewers = liveDetailsResponse.body.items[0].liveStreamingDetails.concurrentViewers;
        info.currentViewers = currentViewers ? parseInt(currentViewers) : 0;
        return info;
      }
    } else { // offline, get last live
      const lastLiveVideoResponse = await getLastLiveVideoIdByChannelId(channelId);

      if (lastLiveVideoResponse.body.items.length > 0) {
        const lastLiveVideoId = lastLiveVideoResponse.body.items[0].id.videoId;
        // const lastLiveDetailsResponse = await getLiveDetailsByVideoId(lastLiveVideoId);
        const lastLiveDetailsResponse = await getLiveDetailsByVideoId_NOAPI(lastLiveVideoId);

        if (lastLiveDetailsResponse.body.items.length > 0) {
          const actualEndTime = lastLiveDetailsResponse.body.items[0].liveStreamingDetails.actualEndTime;
          info.actualEndTime = actualEndTime ? actualEndTime : "No live streaming data found";
          return info;
        }
      }
    }
  } catch (error) {
    console.error('Error fetching live info:', error.message);
    throw error;
  }
}

async function getLiveDetailsByVideoId_NOAPI(videoId) {
  // liveDetailsResponse.body.items[0].liveStreamingDetails.concurrentViewers; actualEndTime
  let liveStreamingDetails = {};
  let rt = { body: { items: [{ liveStreamingDetails: liveStreamingDetails }] } };
  try {
    const url = `https://m.youtube.com/watch?v=${videoId}`;
    const options = {
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
        'accept-encoding': 'gzip, deflate, br',
      },
      decompress: true,
    };

    // console.log("getLiveDetailsByVideoId_NOAPI");
    const response = await got(url, options);
    const html = response.body;

    const regex1 = /collapsedSubtitle\\x22:\\x7b\\x22runs\\x22:\\x5b\\x7b\\x22text\\x22:\\x22(\d{1,3}(,\d{3})*)/;
    const match1 = html.match(regex1);
    if (!match1) {
      liveStreamingDetails["concurrentViewers"] = null;
    } else {
      const viewCount = parseInt(match1[1].replace(/,/g, ""));
      liveStreamingDetails["concurrentViewers"] = viewCount;
    }


    const regex2 = /"endTimestamp":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2})"/;
    const match2 = html.match(regex2);
    if (!match2) {
      liveStreamingDetails["actualEndTime"] = null;
    } else {
      const endTimestamp = match2[1];
      liveStreamingDetails["actualEndTime"] = endTimestamp;
    }

    return rt;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch Live Details");
  }
}


module.exports = {
  getChannelLiveVideoId: getChannelLiveVideoId,
  getLastLiveVideoIdByChannelId: getLastLiveVideoIdByChannelId,
  getLiveDetailsByVideoId: getLiveDetailsByVideoId,
  getLiveInfoByChannelId: getLiveInfoByChannelId

}