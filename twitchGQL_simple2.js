const got = require('got');
async function getChannelStreamData(userQuery) {
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
  const variables = { "login": userQuery };
  try {
    const response = await got.post("https://gql.twitch.tv/gql", {
      json: { query, variables },
      responseType: 'json',
      headers: {
        "Content-Type": "application/json",
        "Client-Id": "r8s4dac0uhzifbpu9sjdiwzctle17ff",
      },
    });

    const jsonResponse = response.body;
    return jsonResponse;
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

(async () => {
  try {
    const result = await getChannelStreamData("sweetcampercs");
    console.log(JSON.stringify(result, null, 1));
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();

/*
{
 "data": {
  "channel": {
   "id": "48093884",
   "__typename": "User",
   "login": "sweetcampercs",
   "lastBroadcast": {
    "id": "40208502615",
    "__typename": "Broadcast",
    "startedAt": "2023-04-06T11:08:37.052237Z",
    "game": {
     "id": "511224",
     "__typename": "Game",
     "displayName": "Apex Legends"
    }
   },
   "stream": {
    "id": "40208502615",
    "__typename": "Stream",
    "createdAt": "2023-04-06T11:08:28Z",
    "game": {
     "id": "511224",
     "__typename": "Game",
     "displayName": "Apex Legends"
    },
    "type": "live",
    "viewersCount": 3880
   },
   "followers": {
    "totalCount": 288614
   }
  }
 },
 "extensions": {
  "durationMilliseconds": 58,
  "requestID": "01GXBSD59M5YX8RQTG1AFGJACJ"
 }
}

{
 "data": {
  "channel": {
   "id": "139047872",
   "__typename": "User",
   "login": "taylorjen",
   "lastBroadcast": {
    "id": "40208861863",
    "__typename": "Broadcast",
    "startedAt": "2023-04-06T16:45:10.059341Z",
    "game": {
     "id": "511224",
     "__typename": "Game",
     "displayName": "Apex Legends"
    }
   },
   "stream": null,
   "followers": {
    "totalCount": 886
   }
  }
 },
 "extensions": {
  "durationMilliseconds": 58,
  "requestID": "01GXBSBYV9TTMTZXJNAMQX2PWT"
 }
}
*/