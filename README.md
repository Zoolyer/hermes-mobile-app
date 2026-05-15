# hermes-mobile-app

Hermes Agent 的移动端 baseline（Expo + React Native + TypeScript）。

## 当前能力（MVP）
- 直连 Hermes 原生 OpenAI 兼容接口：`POST /v1/chat/completions`
- 支持配置 `API Base`、`API Key`、`Model`
- 展示 Hermes 回复（兼容 `choices[0].message.content` / `output_text` / `reply` / `content`）
- 本地持久化：API 地址、Key、Model、聊天记录（AsyncStorage）
- 一键清空会话

## 默认接口
- `http://127.0.0.1:8642/v1`

## 快速启动
```bash
npm install
npm run start
```

然后用 Expo Go 扫码在手机上打开。

## 接口约定
请求：
```json
{
  "model": "hermes-agent",
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "stream": false
}
```

响应（任一字段即可）：
```json
{ "choices": [{ "message": { "content": "你好，我在。" } }] }
```
或
```json
{ "output_text": "你好，我在。" }
```
或
```json
{ "reply": "你好，我在。" }
```

## 说明
- 这版已经从“自定义 `/api/chat`”切到 Hermes 原生 API。
- 如果 Hermes 开了鉴权，就在 App 里填 `API Key`。
- 若你要下一步做微信/飞书机器人式集成，可以直接复用 Hermes 的 `gateway/webhook/plugins` 路线。
