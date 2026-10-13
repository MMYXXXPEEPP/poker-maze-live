# 跑男扑克迷局 — 手机与电脑联机版

## 最简单的云端发布方式

请直接打开仓库中的 **`先看这里-免费云端部署.md`**，按 GitHub → Render（选择免费 Web Service）的步骤部署。

- 服务器：`server.js`（Node.js HTTP + WebSocket，无第三方运行依赖）
- 页面：`public/`（包含手机/电脑响应式 UI、人物头像、抽牌和棋盘动态效果）
- 免费云端部署配置：`render.yaml`
- 健康检查：`/health`
- 启动命令：`npm start`
- 房间链接：云端 HTTPS 域名后自动附带 `?room=XXXXXX`

**重要**：Render 免费服务可能休眠；睡眠/重启会重置内存房间，适合朋友测试和偶尔组局，不保证游戏进度永不丢失。
