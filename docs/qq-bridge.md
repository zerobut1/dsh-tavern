# QQ 私聊桥接（NapCat）

桥接运行在 Tavern 的 Node 后台：QQ → NapCat OneBot 11 正向 WebSocket → 已绑定 Tavern 对话 → QQ。没有第二套提示词、世界书或模型配置；发送输入、生成正文、运行预设和结算都走 Tavern 原有流程。电脑端继续管理角色卡、预设与对话。

## 初次配置

1. 启动 NapCat 并登录机器人 QQ。在 WebUI 配置一个正向 WebSocket 服务：本机 `127.0.0.1:3001`、非空 Access Token、消息格式 `array`，关闭自身消息上报。
2. 在 Tavern 新建并命名一个原生游玩对话。名称须唯一；桥接创建时会固定保存其 `sessionId` 与 `chatId`，之后重命名、切换电脑端对话不会改绑。
3. 在仓库目录运行：

```powershell
node bin/qq-bridge.mjs setup --napcat "D:\Software\NapCat.Shell.Windows.Node" --chat "测试qq机器人" --user 你的QQ号
node bin/qq-bridge.mjs status
node bin/qq-bridge.mjs check
```

`setup` 仅读取 NapCat 配置，不修改它；写入 Tavern 数据目录下的 `qq-bridge.json`，默认 **`enabled: false`**。Token 只保存在本机数据文件中，不应提交、分享或贴入日志。`check` 只连接并调用 `get_login_info`、`get_status`，绝不发送 QQ 消息，也不启用桥接。

第一次安装本功能后重启 Tavern，让新代码加载。可以关闭浏览器，只保留 Tavern 后台及 NapCat。依赖浏览器 DOM 的角色脚本仍受 Tavern 服务端脚本运行时的兼容性限制；请以所用卡的实际测试为准。

## 手动启停

确认白名单和绑定无误后，自行启用：

```powershell
node bin/qq-bridge.mjs enable
node bin/qq-bridge.mjs status
```

停止：

```powershell
node bin/qq-bridge.mjs disable
```

已加载本功能的后台每秒检测配置变化。禁用时断开连接、撤销队列，并在每一次发送前重新读取开关与白名单。停用后正在生成的 Tavern 轮次可能继续完成，但其结果不会再投递到 QQ。已交给 NapCat 的消息无法撤回。

## 可处理的消息

- 只响应 `allowedUserIds` 中的好友私聊，校验登录机器人账号及事件中的账号。
- 群聊、群临时会话、自发消息、图片／语音／转发／混合消息全部忽略，不自动加好友。
- 仅处理本次连接身份验证后收到的新消息，不补发离线历史；消息编号持久化去重。队列最多容纳 8 条，不同输入依次处理。
- 等待与本条输入 `requestId` 对应的正文提交及结算，发送电脑端显示投影中的文字，忽略 HTML 面板和思考过程。超过 1500 字分段发送，最多 30000 字。
- 生成、结算、连接或发送发生错误时，记录在 `qq-bridge-status.json` 和 `qq-bridge-state.json`。不自动重发输入或消息，以免重复生成、重复投递；电脑端可查看原对话。`status` 展示的是最近记录，Tavern 停止时可能已过期。

## 切换角色

在禁用状态下，编辑 `qq-bridge.json` 的 `bindings`，每项提供唯一 `name`、固定 `sessionId`、`chatId`；格式见 [配置示例](../config/qq-bridge.example.json)。每个角色对应一个独立 Tavern 对话。

启用后在 QQ 私聊中发送：

```text
/角色
/切换 测试角色
```

选择会保存在本机，重连及重启后保留；普通消息发送到该角色绑定的对话。角色列表调整后找不到原选择时使用第一项。电脑端手动发消息、改写、回退不会主动推送到 QQ。

## 协议参考

- [NapCat 网络配置](https://napneko.github.io/config/basic)
- [OneBot 11 正向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)
