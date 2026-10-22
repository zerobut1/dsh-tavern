# custom 分支修改备忘

本文件记录个人 `custom` 分支相对上游的源码改动，供日常维护和再次 rebase 时核对。

- 整理日期：2026-10-18。
- 最近同步：2026-10-22，基线为 `upstream/main` 的 `2f50b52fd7453667ca91a7895d099b9c91deb26c`，Tavern 3.1.0。本次纳入 38 个上游提交，保留所有现有自定义功能；自定义请求接口迁入上游拆出的 RPC 模块，后台指令的取消和等待接入新的结算模块。采用上游历史工具调用的固定 user 补位、MVU 面板编辑值在下一轮正文中的一次性说明，以及已退休后台 Agent 的目录过滤。自定义单元测试 211 项、请求回放与后台结算补充单元测试 35 项全部通过，客户端生成检查通过。同步前备份分支为 `codex/backup-custom-before-submit-story-sync-20261022`。
- 同日上一次同步至 `1f790736` 时，经用户确认移除旧原生生图的完整提示词提交、首次参考意见及旧正文分色性能补丁，采用上游内置配图插件、共享高亮和模板正则实现；此次不恢复这些补丁。
- 2026-10-18 曾将 33 个原始提交整理为 17 个功能提交，整理前后源码文件树完全一致。后续变更单独提交；已由上游覆盖的修复按维护原则移除。
- 提交标题和说明均使用中文；合并同一功能的初版及后续修补，按依赖关系排序。

## 同步上游的原则

1. 保留上游新增功能。
2. 上游已经覆盖的修复采用上游实现；核对行为后移除重复的本地补丁。
3. 上游尚未提供的个人新增功能继续保留。
4. 只有实际功能取舍无法同时满足时才需要确认；普通代码冲突按上述原则处理。
5. 后续新增或调整功能时，更新本文件，并将独立功能或修复单独提交。
6. 调研、实验与验证记录只留本地；同步时不重新纳入上游已移出仓库的此类文件。

## 功能清单

### 历史恢复与显示兼容（已移除）

2026-10-21 经用户决定，移除本地显示补丁 `3a36c644` 和 `7e0f380d`：不保留分轮恢复、旧修复格式迁移、旧副本显示过滤及修复输入排除等兼容逻辑。历史恢复和显示采用上游实现；后续遇到具体问题再单独处理。相关恢复源码和测试已与上游一致，本次不改写用户存档。

### 手动后台指令

原生 MVU 对话的输入区新增“后台指令”按钮，用小窗口提交不超过 4000 字的更新要求。后台模型仅针对本次明确要求调用 `mvu_submit_update`，使用当前变量快照，沿用原生 MVU 校验和时间线提交，不续写正文。输入区只保留按钮，成功结果和失败详情均在指令弹窗内查看；可通过“更多 → 停止后台”取消，取消或版本冲突时拒绝迟到写入。最新指令及回执保存在本局，重启中断的任务须手动重试。

2026-10-21 起沿用上游“所有变量结算均保留正文”的实现，移除本地调用中已失效的 `preserveForeground` 参数。

### MVU 变量路径纠错

后台结算前识别把现有字段错嵌到其他分组的路径，返回当前快照中的实际路径供模型重提；新增字典键仍交给原生 MVU 校验。提示词明确以结构和快照为准，避免角色卡文字分组误导字段层级。最小单元测试加入自定义测试入口。

### 局域网访问电脑端界面

`pnpm run lan:tavern [本机IPv4]` 保存监听地址，后续直接执行 `pnpm run start:tavern`；配置命令本身不启动服务。默认保持回环监听，开启后绑定具体网卡，兼容 DSH 0.2.1 拒绝通配地址的约束。支持临时环境变量覆盖及恢复仅本机访问。

启动、就绪检测、状态、停止和重启使用实际地址，PID 文件保留运行时地址和端口，旧记录兼容回环地址。打印的完整访问链接保留 token 和实际端口。局域网普通 HTTP 接口复用 DSH 的鉴权与主机检查，保留独立 capability 和公开静态资源的既有访问方式；手机代理跟随实际上游地址，手机发送与存档救援支持缺少 `crypto.randomUUID` 的 HTTP 环境。

入口：[局域网使用说明](docs/lan-access.md)、[service-network.mjs](bin/service-network.mjs)、[service-lifecycle.mjs](bin/service-lifecycle.mjs)、[routes.js](tavern-plugin/lib/http/routes.js)。仅保留单元测试，已加入 `test:custom:unit`，不启动服务或浏览器。

### 原生测试入口

Windows 下通过 `file:` URL 加载测试预加载模块，以 `fileURLToPath` 解析宿主根目录，支持带空格和中文的路径。宿主补丁自身的测试按平台文件名识别，避免被提前打补丁。真实子进程验证预加载确实完成，并保留测试失败退出码。

入口：[test-tavern.mjs](bin/test-tavern.mjs)、[host-session-patch-preload.mjs](tests/fixtures/host-session-patch-preload.mjs)、[test-tavern-runner.test.mjs](tests/test-tavern-runner.test.mjs)。

### 自定义功能单元测试

执行 `pnpm test:custom:unit`（或 `node bin/test-custom-unit.mjs`）。每次 rebase 上游后必须运行，要求见 [AGENTS.md](AGENTS.md)。测试清单位于 [test-custom-unit.mjs](bin/test-custom-unit.mjs)，只运行相关单元测试；不启动浏览器或真实服务。

覆盖子代理停用、目录过滤与任务状态、顶栏设置、开场及静态状态栏、动态世界书缓存、压缩输入过滤、分叉定位、正文正则与工具回放、每局设置、世界书创建、预设编辑、手机接口和 QQ 桥接。2026-10-22 移除已停用的本地生图、分色补丁用例及入口项，并为迁入上游 RPC 模块的自定义接口与后台取消增加最小单元覆盖。外部服务以替身代替，个别持久化测试使用临时目录。CSS 布局、完整宿主生命周期和真实账号连通性仍属于人工或专门的集成测试范围。

2026-10-21 同步后将上游拆出的顶栏、每局设置和会话视图单元测试，以及内嵌图片读取测试纳入自定义检查。会话视图同时提供世界书目录与角色卡资源访问凭据；手机及 QQ 桥接通过新的视图接口读取历史。

### 酒馆助手创建世界书

兼容《道渊》等角色卡调用的 `getLorebooks()`、`createLorebook(name)` 和 `createLorebookEntry(name, entry)`。世界书保存为资料库中的独立资源，支持按名称读取和更新；创建返回布尔值，单条写入返回新条目的 UID。同名创建不覆盖旧书，也不自动全局启用或改变角色绑定，沿用 SillyTavern 与酒馆助手的创建语义。

准备页、消息页面和卡片脚本共用旧条目字段转换与现有写入校验；准备页中新建独立书不会被当成本局主书草稿，访问其他书也不会替换主书名称。最小单元测试覆盖三种调用入口、落盘回读、同名及并发创建和不自动启用，已加入自定义测试清单。正式会话的 `/cut` 兼容不在此次改动范围。

入口：[worldbook-library.js](tavern-plugin/lib/domain/worldbook-library.js)、[helper-worldbook-creation.js](tavern-plugin/src/client/runtime/helper-worldbook-creation.js)。语义依据为 SillyTavern 的独立世界书保存与酒馆助手的旧创建接口；详细调研记录仅本地保留。

### 预设条目增删

酒馆预设详情的前、中、后三段各提供“添加条目”，创建后自动展开，沿用现有的名称、角色、内容和启用状态编辑。普通词条的编辑区可确认删除，系统占位保持只读。增删会校验预设版本、串行保存，维护源条目、发送顺序和三段布局；删除重复标识时仅移除所选词条，并保留其他词条未保存的草稿。导出与后续运行沿用编辑后的源文件。

入口：[preset-editor.js](tavern-plugin/lib/domain/preset-editor.js)、[preset-library.js](tavern-plugin/src/client/features/preset-library.js)。复用预设编辑器与资料库的最小单元测试，覆盖三段新增、导出及重载、重复标识删除、布局索引、版本冲突和草稿保留，已加入 `test:custom:unit`。

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

2026-10-21 起，前台可用工具跟随上游改为按需读取存档头，同时读取两个单局设置字段，避免性能优化后丢失本局覆盖选择。

上游提供工具结果读取适配时优先复用。历史正文工具回放继续先执行隐藏文本正则，只改变发送给模型的历史形式。保留上游将历史玩家消息一并回放的能力，正文正则不处理玩家原话，本轮输入仍作为普通消息保留。

2026-10-22 采用上游 `7f01e5c0`：历史工具调用之前若既不是 user 消息也不是工具结果，补入固定的“（以下是此前已经发生的剧情。）”，避免 Gemini 拒绝从工具调用开始的历史；补位 ID 从调用 ID 推导，保持请求稳定。此上游修复本身只处理请求顺序。

同日增加本地强制提交校验，并按用户要求改为即时拦截：原生 story/script 游玩开启“正文走工具调用”后，在首个普通文本块送入 Agent/UI 前中止单次传输，拒收该块及后续输出。思考块与工具参数允许通过；被拒绝的整次响应不提交为 assistant 消息，也不执行其中的工具。宿主收到专用失败码后，在同一回合、同一步记录纠正指令并重新请求，要求完整正文只能放入 `submit_story.content`；最多自动纠正五次（加上首次请求最多六次），再次违规则明确失败，不入档、不启动后台结算，通用网络重试不能绕过此上限。用户取消不触发自动纠正。结束校验仅保留拒收入档兜底，不再等待输出完成才纠正。移除上一版为拒收正文扩展的历史收拢范围，正文投影恢复上游实现；纠正上下文保留为插件记录，不伪装为玩家输入。关闭开关、卡片编辑、兼容模式和后台任务保持各自流程，空输出与纯思考沿用原有报错。最小单元测试覆盖流块边界、传输中止、合法工具、取消、作用范围及纠正上限。

即时拦截版本：自定义单元测试 220 项、请求组装与网络重试补充单元测试 11 项通过；客户端生成检查与入口语法检查通过。未运行浏览器或真实模型验证。

入口：[story-tool-submission.js](tavern-plugin/lib/domain/story-tool-submission.js)、[conversation-background.js](tavern-plugin/lib/domain/conversation-background.js)、[play-controls.js](tavern-plugin/src/client/features/play-controls.js)、[global-settings.js](tavern-plugin/src/client/modules/global-settings.js)。

### 13. 兼容调用记录失败提示（已由上游接管）

2026-10-19 起移除本地“弹出实际错误、成功后清除”的修复，采用上游方式：兼容能力调用记录保存失败时只写控制台警告，不弹前台错误。它只改变诊断记录失败的提示方式，不会补齐缺失的兼容接口，也不屏蔽其他运行错误。

入口：[helper-script-runtime.js](tavern-plugin/src/client/runtime/helper-script-runtime.js)。

### 14. 消息滚动与文本高亮性能（已由上游接管）

2026-10-22 经用户确认，移除本地按消息延迟注册高亮的补丁，采用上游每个文档共用一组高亮与主题监听的实现。

入口：[text-colors.js](tavern-plugin/src/client/text-colors.js)。

### 15. 完整生图提示词提交（已移除）

2026-10-22 经用户确认，随上游删除旧原生生图链路，移除本地专用提交工具、提示词与测试，采用随附的 `dsh-tavern-image` 插件，不将旧协议迁入新插件。

### 16. 首次生图参考意见（已移除）

2026-10-22 经用户确认，移除原生生图按钮下方的参考意见输入框及其后端传递逻辑，使用上游配图插件自己的提示词编辑与重画流程。

### 17. 手机轻量聊天与角色卡状态栏

增加基于 assistant-ui ChatGPT 界面的 `/mobile` 入口，提供基础消息收发和单独查看角色卡状态栏的界面，接入现有手机访问服务。复用电脑端的生成、历史和显示投影，避免向手机聊天界面直接输出原始隐藏文本或面板 HTML。

入口：[手机界面源码](tavern-plugin/src/mobile/)、[mobile-chat.js](tavern-plugin/lib/http/mobile-chat.js)、[mobile-access.js](tavern-plugin/lib/http/mobile-access.js)、[mobile-status.js](tavern-plugin/src/client/features/mobile-status.js)。

## 不随这些提交保存的数据

角色卡具体配置、预设、全局正则的实际规则、MVU 变量、聊天存档和本地立绘等属于用户数据，需要单独备份。Git 分支及本文件不能代替存档备份。

前端生成文件 `tavern-plugin/lib/client.js` 随对应功能提交；修改前端源码后通过现有构建脚本更新，避免源码与实际加载内容不一致。
