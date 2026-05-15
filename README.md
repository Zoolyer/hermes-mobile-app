# hermes-mobile-app

Hermes Agent 的移动端 baseline（Expo + React Native + TypeScript）。

## 当前能力（MVP）
- 配置 `API Base`（例如 `http://192.168.1.10:8123`）
- 发送聊天消息到 `POST /api/chat`
- 展示 Hermes 回复（兼容 `reply` / `content` 字段）
- 本地持久化：API 地址、聊天记录（AsyncStorage）
- 一键清空会话

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
  "message": "你好",
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

响应（任一字段即可）：
```json
{ "reply": "你好，我在。" }
```
或
```json
{ "content": "你好，我在。" }
```

## 说明
- 本项目优先级：可用性、响应速度、稳定性。
- 当前未接入鉴权；若后端需要 token，可在下一步补 `Authorization` 头配置。