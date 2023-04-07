async function getChannelStreamData() {
const query = `
query Search_Query(
  $noQuery: Boolean!
  $noQueryFragment: Boolean!
  $platform: String!
  $queryFragment: String!
  $requestID: ID
  $target: SearchForTarget
  $userQuery: String!
) {
  ...SearchAutocomplete_suggestions_d4heS
  ...SearchContent_categories
  ...SearchContent_channels
  ...SearchContent_overview
  ...SearchContent_videos
}

fragment SearchAutocomplete_suggestions_d4heS on Query {
  searchSuggestions(queryFragment: $queryFragment, requestID: $requestID) @skip(if: $noQueryFragment) {
    edges {
      node {
        id
        __typename
        text
        content {
          __typename
          ...SuggestionSearchItem_suggestion
          ... on SearchSuggestionCategory {
            id
            __typename
          }
          ... on SearchSuggestionChannel {
            id
            __typename
          }
        }
      }
    }
    tracking {
      modelTrackingID
      responseID
    }
  }
}

fragment SearchCategoryCard_game on Game {
  name
  displayName
  boxArtURL
  viewersCount
  ...useGameTagListFragment_game
}

fragment SearchChannelCard_channel on User {
  id
  __typename
  login
  ...SearchOfflineChannel_channel
  stream {
    id
    __typename
    ...SearchStreamCard_stream
  }
  roles {
    isPartner
  }
}

fragment SearchContent_categories on Query {
  searchFor(userQuery: $userQuery, platform: $platform, target: $target) @skip(if: $noQuery) {
    games {
      cursor
      items {
        id
        __typename
        ...SearchCategoryCard_game
      }
    }
  }
}

fragment SearchContent_channels on Query {
  searchFor(userQuery: $userQuery, platform: $platform, target: $target) @skip(if: $noQuery) {
    channels {
      cursor
      items {
        id
        __typename
        ...SearchChannelCard_channel
      }
    }
  }
}

fragment SearchContent_overview on Query {
  ...SearchContent_categories
  ...SearchContent_channels
  searchFor(userQuery: $userQuery, platform: $platform, target: $target) @skip(if: $noQuery) {
    relatedLiveChannels {
      ...SearchRelatedLiveChannels_channels
    }
    channels {
      cursor
      items {
        id
        __typename
        ...SearchChannelCard_channel
      }
    }
    games {
      cursor
      items {
        id
        __typename
        ...SearchCategoryCard_game
      }
    }
    videos {
      cursor
      items {
        id
        __typename
        ...SearchVideoCard_video
      }
    }
  }
}

fragment SearchContent_videos on Query {
  searchFor(userQuery: $userQuery, platform: $platform, target: $target) @skip(if: $noQuery) {
    videos {
      cursor
      items {
        id
        __typename
        ...SearchVideoCard_video
      }
    }
  }
}

fragment SearchOfflineChannel_channel on User {
  displayName
  followers {
    totalCount
  }
  lastBroadcast {
    startedAt
    id
    __typename
  }
  login
  profileImageURL(width: 150)
}

fragment SearchRelatedLiveChannels_channels on SearchForResultRelatedLiveChannels {
  items {
    id
    __typename
    stream {
      id
      __typename
      viewersCount
      previewImageURL
      game {
        id
        __typename
        name
        displayName
      }
      broadcaster {
        id
        __typename
        login
        displayName
        roles {
          isPartner
        }
      }
    }
  }
}

fragment SearchStreamCard_stream on Stream {
  broadcaster {
    displayName
    login
    broadcastSettings {
      title
      id
      __typename
    }
    id
    __typename
  }
  game {
    displayName
    name
    id
    __typename
  }
  id
  __typename
  previewImageURL
  viewersCount
}

fragment SearchVideoCard_video on Video {
  publishedAt
  owner {
    id
    __typename
    displayName
    login
    roles {
      isPartner
    }
  }
  id
  __typename
  game {
    id
    __typename
    name
    displayName
  }
  lengthSeconds
  previewThumbnailURL
  title
  viewCount
}

fragment SuggestionSearchItem_suggestion on SearchSuggestionContent {
  __isSearchSuggestionContent: __typename
  __typename
  ... on SearchSuggestionChannel {
    id
    __typename
    isVerified
    login
    profileImageURL(width: 50)
    user {
      id
      __typename
      stream {
        id
        __typename
        game {
          id
          __typename
        }
      }
    }
  }
  ... on SearchSuggestionCategory {
    id
    __typename
    boxArtURL
    game {
      name
      id
      __typename
    }
  }
}

fragment useGameTagListFragment_game on Game {
  gameTags: tags(limit: 10, tagType: CONTENT) {
    ...useTagLinkFragment_tag
    id
    __typename
  }
}

fragment useTagLinkFragment_tag on Tag {
  id
  __typename
  tagName
  localizedDescription
  localizedName
}
`;

  const variables = {"noQuery":false,"noQueryFragment":true,"platform":"mobile_web","queryFragment":"","requestID":null,"target":null,"userQuery":"kimskeleton0718"};

  const response = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
	'Client-Id': 'r8s4dac0uhzifbpu9sjdiwzctle17ff',
    },
    body: JSON.stringify({ query, variables })
  });

  const jsonResponse = await response.json();
  console.log("jsonResponse:", jsonResponse);
  return 	jsonResponse ;
  //const firstStream = jsonResponse.data.searchFor.channels.items[0]?.stream;
  
}


(async () => {
  try {
    const result = await getChannelStreamData();
    console.log(result);
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();