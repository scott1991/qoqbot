# qoqbot

qoqbot 是一個用 Node.js 撰寫的 Twitch 聊天機器人，基於 `twitch-commando`。目前主要功能包含：

- Twitch / YouTube 直播者觀看數查詢
- 註冊時間、追隨時間等查詢命令
- 固定回覆類命令
- 可選的 AI chat 回覆功能

## Requirements

- Node.js 18
- npm 10

專案根目錄已提供 `.nvmrc`，可在目錄內執行：

```bash
nvm use
```

如果本機還沒有對應版本，也可以先執行：

```bash
nvm install 18
nvm use 18
```

## Install

1. clone 此 repo。
2. 安裝依賴：

```bash
npm install
```

3. 複製 [`config.example.json`](/home/cake/code/node/qoqbot/config.example.json) 為 `config.json`。
4. 在 `config.json` 填入 Twitch OAuth、YouTube API key 與其他必要設定。

## Run

啟動 bot：

```bash
npm start
```

或：

```bash
node index.js
```

`npm test` 目前只是 placeholder，不能當成正式測試。

## Project Layout

- [`index.js`](/home/cake/code/node/qoqbot/index.js)：bot 進入點，初始化 client、provider 與 AI responder
- [`commands/streamers/config.js`](/home/cake/code/node/qoqbot/commands/streamers/config.js)：直播者命令定義
- [`commands/streamers/ViewerCommand.js`](/home/cake/code/node/qoqbot/commands/streamers/ViewerCommand.js)：批次註冊 viewer 類命令
- [`commands/querys/`](/home/cake/code/node/qoqbot/commands/querys)：查詢類命令
- [`commands/samples/`](/home/cake/code/node/qoqbot/commands/samples)：固定回覆或簡單範例命令
- [`service/`](/home/cake/code/node/qoqbot/service/)：共用 service，例如 Twitch / YouTube 查詢與 AI chat responder
- [`provider/JSONProvider.js`](/home/cake/code/node/qoqbot/provider/JSONProvider.js)：簡單 JSON provider
- [`database.json`](/home/cake/code/node/qoqbot/database.json)：provider 使用的資料檔

## Commands

### 直播者查詢

直播者 viewer 指令不是一個人一個檔案，而是集中定義在 [`commands/streamers/config.js`](/home/cake/code/node/qoqbot/commands/streamers/config.js)。

例如：

- `!龜狗人數`
- `!Tama人數`

如果要新增或修改直播者命令，優先改 `config.js`，不要另外新增一堆 command 檔案。

### 其他查詢與固定回覆

目前 repo 內還有：

- `!註冊時間`
- `!追隨時間`
- `!cd`
- 其他在 [`commands/samples/`](/home/cake/code/node/qoqbot/commands/samples/) 的固定回覆命令

## AI Chat

AI chat 設定在 `config.json` 的 `aichat` 區塊，範例可參考 [`config.example.json`](/home/cake/code/node/qoqbot/config.example.json)。

目前設計是：

- 只保留每個 channel 最新的 `max_context_messages` 則非指令訊息
- cooldown 期間持續收集訊息，但不送出 AI
- 累積到 `min_messages` 則新訊息後，且 cooldown 已過，才允許 activity trigger
- mention bot 名稱也可以觸發，但同樣受 cooldown 限制

建議測試期先用：

- `enabled: true`
- `dry_run: true`

這樣只會在 log 中看到 AI 回覆，不會真的發到聊天室。

系統 prompt 預設由 [`prompts/aichat-system.txt`](/home/cake/code/node/qoqbot/prompts/aichat-system.txt) 載入。

## Manual Testing

目前沒有完整自動化測試。修改後建議：

1. 啟動 bot。
2. 在安全的 Twitch channel 手動測試命令。
3. 若改到 AI chat，先用 `dry_run: true` 觀察 log 與觸發頻率。

## License

ISC
