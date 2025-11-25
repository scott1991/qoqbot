const got = require('got');
const { client_id } = require('../config.json');
const utils = require('./utils');

function getUserByNameTwitchAPI(name) {
  const rootURL = 'https://api.twitch.tv/helix';
  return got('users', {
    headers: {
      'Authorization': 'Bearer ' + 'rzjlwij2jih1ok7uktk7uerzko9019', //d62z1moylii14z8z8a2swlttm4i5yu
      'Client-ID': client_id
    },
    prefixUrl: rootURL,
    searchParams: { login: name },
    responseType: 'json'
  });
}

function getUserByName_twitchinsights(name) {
  const url = 'https://api.twitchinsights.net/v1/user/status/' + name;
  return got(url, {
    responseType: 'json'
  });
}

async function getLiveViewersCountByName_twitchtracker(username) {
  let url = 'https://twitchtracker.com/' + username;
  try {
    const options = {
      decompress: true,
    };
    const response = await got(url, options);
    const matches = response.body.match(/<span class="live-stat">(\d+)<\/span>/);
    const number = matches ? matches[1] : null;
    return number;
  } catch (error) {
    console.log(error.response.body);
    throw error;
  }
}

async function getLiveViewersCountByName(username) {
  let info = {};
  try {

    let streamdata = await getStreamDataGQL(username);
    if (streamdata.body && streamdata.body.data.channel.stream) {
      info = {
        viewers: streamdata.body.data.channel.stream.viewersCount,
        time: streamdata.body.data.channel.stream.startedAt
      }
    } else {
      info = {
        viewers: null,
        time: streamdata.body.data.channel.lastBroadcast.startedAt
      }
    }


    return info;
  } catch (error) {
    console.log(error.response);
    throw error;
  }

}

async function getStreamStartTimeByName(username) {
  try {
    const streamdata = await getStreamDataGQL(username);
    console.log('GQL Response for', username, ':', JSON.stringify(streamdata.body, null, 2));
    
    if (streamdata.body && streamdata.body.data && streamdata.body.data.channel) {
      if (streamdata.body.data.channel.stream) {
        // Channel is currently live
        return {
          isLive: true,
          startTime: streamdata.body.data.channel.stream.createdAt
        };
      } else if (streamdata.body.data.channel.lastBroadcast) {
        // Channel is offline
        return {
          isLive: false,
          lastStreamTime: streamdata.body.data.channel.lastBroadcast.startedAt
        };
      }
    }
    
    // Channel not found or no data
    throw new Error('Channel not found');
  } catch (error) {
    console.log(error.response);
    throw error;
  }
}

async function getStreamDataGQL(username) {
  const query = `
  query ChannelAboutPage_Query($login: String!) { 
    channel: user(login: $login) { id, __typename, login, ...ChannelStatus_user } 
  }
  
  fragment ChannelStatus_user on User {
    lastBroadcast { id, __typename, startedAt, game { id, __typename, displayName } }, 
    stream { id, __typename, createdAt, game { id, __typename, displayName }, type, viewersCount }, 
    followers { totalCount }
  }
`;

  const variables = { "login": username };

  return got.post("https://gql.twitch.tv/gql", {
    json: { query, variables },
    responseType: 'json',
    headers: {
      "Content-Type": "application/json",
      "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
    },
  });

}


module.exports = {
  getUserByName: getUserByName_twitchinsights,
  getLiveViewersCountByName: getLiveViewersCountByName,
  getStreamStartTimeByName: getStreamStartTimeByName
}

// curl 'https://api.twitchinsights.net/v1/user/status/twitchdev'
// {
// 	"id": "141981764",
// 	"displayName": "TwitchDev",
// 	"createdAt": "2016-12-14T20:32:28Z",
// 	"updatedAt": "",
// 	"deletedAt": "",
// 	"userType": "",
// 	"broadcasterType": "partner",
// 	"unavailableReason": ""
// }

/*
curl -X GET 'https://api.twitch.tv/helix/users?login=twitchdev' \
-H 'Authorization: Bearer 2k3fxvby64nx13usm453svbngdcw7f' \
-H 'Client-Id: 0k4j07seiph3z5eszmfecaxddidcx1'

{
  "data": [{
    "id": "141981764",
    "login": "twitchdev",
    "display_name": "TwitchDev",
    "type": "",
    "broadcaster_type": "partner",
    "description": "Supporting third-party developers building Twitch integrations from chatbots to game integrations.",
    "profile_image_url": "https://static-cdn.jtvnw.net/jtv_user_pictures/8a6381c7-d0c0-4576-b179-38bd5ce1d6af-profile_image-300x300.png",
    "offline_image_url": "https://static-cdn.jtvnw.net/jtv_user_pictures/3f13ab61-ec78-4fe6-8481-8682cb3b0ac2-channel_offline_image-1920x1080.png",
    "view_count": 19044088,
    "created_at": "2016-12-14T20:32:28Z"
  }]
}
*/
