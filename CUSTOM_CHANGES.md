# custom 分支修改备忘

本文件记录个人 `custom` 分支相对上游的源码改动，供日常维护和再次 rebase 时核对。

- 整理日期：2026-10-18。
- 最近同步：2026-10-20，基线为 `upstream/main` 的 `279428894c381c84ec15d56475628720f0307723`，Tavern 3.0.0。更新范围与冲突处理见[同步记录](docs/verification/upstream-rebase-20261020.md)。
- 2026-10-18 曾将 33 个原始提交整理为 17 个功能提交，整理前后源码文件树完全一致。后续变更单独提交；已由上游覆盖的修复按维护原则移除。
- 提交标题和说明均使用中文；合并同一功能的初版及后续修补，按依赖关系排序。

## 同步上游的原则

1. 保留上游新增功能。
2. 上游已经覆盖的修复采用上游实现；核对行为后移除重复的本地补丁。
3. 上游尚未提供的个人新增功能继续保留。
4. 只有实际功能取舍无法同时满足时才需要确认；普通代码冲突按上述原则处理。
5. 后续新增或调整功能时，更新本文件，并将独立功能或修复单独提交。

## 功能清单

### 原生测试入口

Windows 下通过 `file:` URL 加载测试预加载模块，以 `fileURLToPath` 解析宿主根目录，支持带空格和中文的路径。宿主补丁自身的测试按平台文件名识别，避免被提前打补丁。真实子进程验证预加载确实完成，并保留测试失败退出码。

入口：[test-tavern.mjs](bin/test-tavern.mjs)、[host-session-patch-preload.mjs](tests/fixtures/host-session-patch-preload.mjs)、[test-tavern-runner.test.mjs](tests/test-tavern-runner.test.mjs)。

### 自定义功能单元测试

执行 `pnpm test:custom:unit`（或 `node bin/test-custom-unit.mjs`）。每次 rebase 上游后必须运行，要求见 [AGENTS.md](AGENTS.md)。测试清单位于 [test-custom-unit.mjs](bin/test-custom-unit.mjs)，只运行相关单元测试；不启动浏览器或真实服务。

覆盖子代理停用、目录过滤与任务状态、顶栏设置、开场及静态状态栏、动态世界书缓存、压缩输入过滤、分叉定位、正文正则与工具回放、每局设置、文本高亮、生图完整提示词及首次参考意见、手机接口和 QQ 桥接。外部服务以替身代替，个别持久化测试使用临时目录。CSS 布局、完整宿主生命周期和真实账号连通性仍属于人工或专门的集成测试范围。

### QQ 私聊桥接

通过本机 NapCat OneBot 11 正向 WebSocket，将白名单好友的文字私聊提交到固定的 Tavern 原生对话，沿用角色卡、预设、世界书和后台结算。按输入请求编号取得本轮正文，只发送显示投影中的文字；支持对话别名切换、持久化消息去重、串行处理和断线重连。

2026-10-20 起，回复按空行分条投递，显示投影中的独立文字块保留段落边界；段内单个换行保留，超长段落再按 Unicode 字符切分。整轮超出 20 条时在发送前拒绝；分条发送仍逐条检查授权，失败时不重试或续发。

默认禁用；`bin/qq-bridge.mjs` 提供配置、只读检查、状态与手动启停，禁用状态不连接 NapCat。群聊、临时会话、自身消息及非文字输入不处理；每次发送前重新检查开关、账号和白名单。用户的 Token 和绑定保存在被 Git 忽略的数据目录。

入口：[qq-bridge.md](docs/qq-bridge.md)、[qq-bridge-runtime.js](tavern-plugin/lib/qq-bridge-runtime.js)、[qq-bridge.js](tavern-plugin/lib/domain/qq-bridge.js)、[conversation-messenger.js](tavern-plugin/lib/domain/conversation-messenger.js)。

以下编号沿用首次整理时的顺序，已由上游接管的项目保留说明。源码链接指向主要维护入口，不穷举生成文件。

### 01. 项目环境

固定 `packageManager` 为 `pnpm@11.25.0`，并忽略本地 `.kimix_cache`。

入口：[package.json](package.json)、[.gitignore](.gitignore)。

### 02. 关闭子代理并重新创建干净上下文

提供本局子代理管理与关闭入口，停用旧上下文的复用并释放常驻实例。后续后台或生图任务按需创建新会话，旧检查点不能将已关闭的上下文重新带回来。原生页头与酒馆列表同步过滤已关闭的子代理。

关闭后仍保留历史日志；这项功能不等于删除磁盘存档。运行中的任务受到关闭条件检查。

2026-10-20 起接入上游可自定义顶栏，作为“子代理”快捷入口与状态、导出共存；可在顶栏设置中移除或重新添加，窄屏时随其他入口折叠到更多菜单，不再独立注册旧顶栏插槽。

入口：[background-agent-sessions.js](tavern-plugin/lib/background-agent-sessions.js)、[background-session-retirement.js](tavern-plugin/lib/domain/background-session-retirement.js)、[play-controls.js](tavern-plugin/src/client/features/play-controls.js)、[subagent-catalog-sync.js](tavern-plugin/src/client/subagent-catalog-sync.js)。

### 03. 角色卡 HTML 开场兼容

兼容依赖视口高度、绝对定位的开场页面，避免自动高度计算破坏布局。整体缩进的完整 HTML 文档仍按页面渲染。兼容通过 `setChatMessages` 批量接口选择角色卡已有开场。

入口：[frame-viewport-height.js](tavern-plugin/src/client/modules/frame-viewport-height.js)、[frame-document.js](tavern-plugin/src/client/runtime/frame-document.js)、[display-source.js](tavern-plugin/lib/domain/display-source.js)、[opening-preview.js](tavern-plugin/src/client/opening-preview.js)。

### 04. 静态状态栏保留

首轮正文没有提供新的状态栏片段时，继续使用角色卡开场提供的静态面板，避免首轮回复后面板消失。

入口：[persistent-status-view.js](tavern-plugin/lib/domain/persistent-status-view.js)。

### 05. 酒馆助手变量宏与世界书缓存

原生世界书展开酒馆助手变量宏，包括 `{{format_message_variable::stat_data}}`。读取消息变量的条目视为动态内容，避免变化中的变量进入固定的世界书缓存前缀。

入口：[worldbook-recall.js](tavern-plugin/lib/domain/worldbook-recall.js)、[worldbook-placement.js](tavern-plugin/lib/domain/worldbook-placement.js)。

### 06. 前台写作规则以预设为主

精简开局的固定写作示例和重复的正文限制，让预设与人物卡决定文风及输出形式。保留前台只读查询变量、后台负责 MVU 更新的分工约束。

入口：[session-seed-trajectory.js](tavern-plugin/lib/domain/session-seed-trajectory.js)、[turn-orchestration.js](tavern-plugin/lib/domain/turn-orchestration.js)。

### 07. 排除历史世界书快照

前台请求、压缩材料与上下文计量排除历史轮次注入的世界书快照，保留当前轮快照，减少重复上下文。历史快照仍保存在原始会话日志中；这项修改不改变世界书条目的检索和激活策略。

2026-10-20 起保留上游的分卷摘要及最旧卷合并流程，在计算压缩范围与预算前先过滤过期世界书快照；本地正文正则继续作用于压缩输入及保留的最近原文。

入口：[worldbook-snapshot.js](tavern-plugin/lib/domain/worldbook-snapshot.js)、[foreground-orchestration-strategies.js](tavern-plugin/lib/domain/foreground-orchestration-strategies.js)、[story-compaction.js](tavern-plugin/lib/domain/story-compaction.js)、[tavern-token-meter.js](tavern-plugin/lib/domain/tavern-token-meter.js)。

### 08. 分叉与重写轮次定位

恢复重写正文的分叉入口，按故事轮次对应的原生轮次定位历史检查点。新分支清空继承的待发送队列，防止发送新消息时再次提交来源对话的旧输入。

入口：[conversation-fork-point.js](tavern-plugin/lib/domain/conversation-fork-point.js)、[conversation-fork-targets.js](tavern-plugin/lib/domain/conversation-fork-targets.js)、[index.js](tavern-plugin/lib/index.js) 中的分叉绑定逻辑。

### 09. 回退后的结算状态显示

当前结算状态只使用当前时间线分支的任务记录，避免回退前的旧分支任务覆盖状态显示。这项补丁仅修正任务状态的选择，不改变变量回退算法。

入口：[background-task-coordinator.js](tavern-plugin/lib/domain/background-task-coordinator.js)。

### 10. 原生历史修复与压缩检查点保护

将恢复正文的原生修复事件识别为历史编辑，保护模板同步过程中的原生压缩检查点。修复正文时必须在有效的原生轮次和步骤内写入，故事轮次另行保留，避免运行时看似正常、重启后却因日志格式校验失败而无法加载。

2026-10-19 起，检查点识别、通用写入保护及整批历史修复使用上游实现。本地保留历史修复事件的编辑识别，以及模板恢复检查点时的来源保护。

入口：[session-surface-mutations.js](tavern-plugin/lib/domain/session-surface-mutations.js)、[native-surface-repair.js](tavern-plugin/lib/domain/native-surface-repair.js)、[compaction-checkpoint.js](tavern-plugin/lib/domain/compaction-checkpoint.js)、[template-history.js](tavern-plugin/lib/domain/template-history.js)。

### 11. 全局正则管理及统一过滤

恢复已保存正文的预设正则。在正则库中展示全局正则，并提供独立开关及“显示与上下文／仅显示／仅上下文”作用范围。

普通历史、压缩输入和压缩后保留的原文复用上下文正则。开启工具调用时，在历史正文转成工具参数之前先执行过滤，防止隐藏文本绕过正则。原始日志保留原文。

入口：[regex-library.js](tavern-plugin/src/client/features/regex-library.js)、[tavern-extension-settings.js](tavern-plugin/lib/domain/tavern-extension-settings.js)、[reply-presentation.js](tavern-plugin/lib/domain/reply-presentation.js)、[story-compaction.js](tavern-plugin/lib/domain/story-compaction.js)、[model-stream.js](tavern-plugin/lib/hooks/model-stream.js)、[history-tool-call.js](tavern-plugin/lib/domain/history-tool-call.js)。

### 12. 每局统一工具调用设置

跟随上游合并开关：本局只保留“正文走工具调用”，同时控制本轮正文提交及历史玩家消息、正文的工具参数回放。可选“跟随全局／开启／关闭”，从下一次请求生效，分叉继承来源对话的当前选择。工具结果适配和提交正文时的编辑步骤保护使用上游实现。

兼容旧对话的两个字段：任一项显式开启则合并为开启；只有显式关闭则合并为关闭；两项均未设置则继续跟随全局。读取时不批量改写存档，重新选择或 fork 后只保存统一字段，清除旧历史字段。旧接口写入历史字段仍可用，但作为统一开关处理。

上游提供工具结果读取适配时优先复用。历史正文工具回放继续先执行隐藏文本正则，只改变发送给模型的历史形式。保留上游将历史玩家消息一并回放的能力，正文正则不处理玩家原话，本轮输入仍作为普通消息保留。

入口：[story-tool-submission.js](tavern-plugin/lib/domain/story-tool-submission.js)、[conversation-background.js](tavern-plugin/lib/domain/conversation-background.js)、[play-controls.js](tavern-plugin/src/client/features/play-controls.js)、[global-settings.js](tavern-plugin/src/client/modules/global-settings.js)。

### 13. 兼容调用记录失败提示（已由上游接管）

2026-10-19 起移除本地“弹出实际错误、成功后清除”的修复，采用上游方式：兼容能力调用记录保存失败时只写控制台警告，不弹前台错误。它只改变诊断记录失败的提示方式，不会补齐缺失的兼容接口，也不屏蔽其他运行错误。

入口：[helper-script-runtime.js](tavern-plugin/src/client/runtime/helper-script-runtime.js)。

### 14. 消息滚动与文本高亮性能

只为实际匹配到文本的范围注册高亮，减少空范围和重复处理带来的滚动开销。

入口：[text-colors.js](tavern-plugin/src/client/text-colors.js)。

### 15. 完整生图提示词提交

增加完整提示词提交接口，适配 ComfyUI 直接使用完整提示词的方式，为首次构图和调整提供对应提示词。其他生图模式继续使用原有流程。

入口：[scene-image-prompt.js](tavern-plugin/lib/domain/scene-image-prompt.js)、[scene-illustration.js](tavern-plugin/lib/domain/scene-illustration.js)、[scene-image-direct-plan.md](tavern-plugin/prompts/scene-image-direct-plan.md)、[scene-image-direct-adjustment.md](tavern-plugin/prompts/scene-image-direct-adjustment.md)。使用说明见[场景生图文档](docs/scene-images.md)。

### 16. 首次生图参考意见

点击生图按钮后，在消息操作区下方展开可选参考意见输入框。意见传给构图任务，留空时自动构图。

入口：[scene-images.js](tavern-plugin/src/client/features/scene-images.js)、[scene-illustration.js](tavern-plugin/lib/domain/scene-illustration.js)。

### 17. 手机轻量聊天与角色卡状态栏

增加基于 assistant-ui ChatGPT 界面的 `/mobile` 入口，提供基础消息收发和单独查看角色卡状态栏的界面，接入现有手机访问服务。复用电脑端的生成、历史和显示投影，避免向手机聊天界面直接输出原始隐藏文本或面板 HTML。

入口：[手机界面源码](tavern-plugin/src/mobile/)、[mobile-chat.js](tavern-plugin/lib/http/mobile-chat.js)、[mobile-access.js](tavern-plugin/lib/http/mobile-access.js)、[mobile-status.js](tavern-plugin/src/client/features/mobile-status.js)。

## 不随这些提交保存的数据

角色卡具体配置、预设、全局正则的实际规则、MVU 变量、聊天存档和本地立绘等属于用户数据，需要单独备份。Git 分支及本文件不能代替存档备份。

前端生成文件 `tavern-plugin/lib/client.js` 随对应功能提交；修改前端源码后通过现有构建脚本更新，避免源码与实际加载内容不一致。
