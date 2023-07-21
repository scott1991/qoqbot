# qoqbot

qoqBot 是一款使用 Node.js 建立的 Twitch 聊天機器人，並基於 `twitch-commando` 開發。它具有多種功能，包括查詢特定 Twitch 和 YouTube 直播者的觀看人數、他們最後一次結束直播的時間，或是一般的固定回覆，等等。該機器人具有高度可定制性，命令存儲在單獨的腳本中，便於修改。

## Install

1. 將 clone repository 或使用github網頁打包zip下載到你的電腦。

2. 至機器人的目錄並運行 `npm install` 以安裝必要的dependency。請確保您的機器上已安裝 Node.js 和 npm。

3. 複製或重新命名 `config.json.expmple` 文件，改為`config.json`，並添加您的 Twitch OAuth token, Youtube api key和其他必要的值。

4. 運行 `node index.js` 以啟動機器人。

## Feature

1. **查詢直播者資料**：機器人可以查詢特定 Twitch 和 YouTube 直播者的觀眾數以及他們最後一次結束直播的時間。命令存儲在 `commands/streamers/twitch` 和 `commands/streamers/yt` 目錄中，每位直播者都有自己的腳本。

   例如，'!龜狗人數' 命令可用於查詢 Twitch 直播者 'sweetcampercs' 的觀眾數，而 '!Tama人數' 命令則可用於查詢 YouTube 直播者 '久遠たま' 的觀眾數，可以參考現有檔案增加。

2. **問候語**：當調用 '!安安安安' 命令時，機器人可以回應問候語。可以參考此命令製作固定回覆。

3. **冷卻時間**：機器人可以使用 '!cd' 命令顯示當前命令的冷卻時間，它讀取config中的`cd`。

4. **註冊時間與追隨時間**：機器人可以查詢聊天室中用戶的註冊時間和追隨時間。使用 '!註冊時間' 和 '!追隨時間'。這兩個命令其實是轉發給其他聊天室機器人，所以也是固定回覆的一種。

## 授權

該項目根據 ISC 授權條款授權。
