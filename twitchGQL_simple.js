const got = require('got');
async function getChannelStreamData(userQuery) {
  const query = `
  query Search_Query($noQuery: Boolean!, $platform: String!, $target: SearchForTarget, $userQuery: String!) 
  { 
    ...SearchContent_channels 
  }
  
  fragment SearchChannelCard_channel on User { 
    id, __typename, login, ...SearchOfflineChannel_channel, 
    stream { id, __typename, ...SearchStreamCard_stream }, 
    roles { isPartner } 
  }
  
  fragment SearchContent_channels on Query { 
    searchFor(userQuery: $userQuery, platform: $platform, target: $target) @skip(if: $noQuery) { 
      channels { cursor, items { id, __typename, ...SearchChannelCard_channel } } 
    } 
  }
  
  fragment SearchOfflineChannel_channel on User { 
    displayName, followers { totalCount }, lastBroadcast { startedAt, id, __typename }, login 
  }
  
  fragment SearchStreamCard_stream on Stream { 
    broadcaster { displayName, login, broadcastSettings { title, id, __typename }, id, __typename }, 
    game { displayName, name, id, __typename }, 
    id, __typename, viewersCount 
  }
`;

  
  const variables = {"noQuery":false,"platform":"mobile_web","target":null,"userQuery":userQuery};
  
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
    console.log(JSON.stringify(result,null, 1));
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();

/*
{
	"data": {
		"searchFor": {
			"channels": {
				"cursor": "",
				"items": [{
					"id": "834748273",
					"__typename": "User",
					"login": "kimskeleton0718",
					"displayName": "김스켈레톤",
					"followers": {
						"totalCount": 54
					},
					"lastBroadcast": {
						"startedAt": "2023-04-06T14:24:06.578957Z",
						"id": "40208328871",
						"__typename": "Broadcast"
					},
					"stream": null,
					"roles": {
						"isPartner": false
					}
				}]
			}
		}
	},
	"extensions": {
		"durationMilliseconds": 129,
		"requestID": "01GXBHDZZ4ZBMYDZY3SM5WWES2"
	}
}
*/