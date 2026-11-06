# DSH Tavern

## 提交

每完成一个比较大的功能点或修复，立即单独提交一次；提交只包含该功能点或修复，避免混入无关改动。如果只是很琐碎的改动，比如调整一下文本、按钮位置，则不必自动提交。

## 文档

本地写的 docs（研究记录、实验笔记、临时调研）**不提交、不推送**，只留在工作区或仓库外。有价值的结论写进提交说明或已有的功能文档，不要新增 docs 文件入库。

## 推送

## 分支

- `main`：当前版本，适配 DSH 0.2.1。日常开发在这里。
- `stable`：旧稳定版，适配 DSH 0.1.5，**已停止更新**：修复只进 main，不再 cherry-pick 到 stable。两条分支的安装脚本与应用内更新各自跟随自己的分支，不要互相合并。

GitHub Actions 会频繁向 `origin/main`（以及 `origin/stable`）推送 `chore: publish runtime manifest [skip ci]`（只改 `dsh-tavern-runtime.json`），导致本地推送被拒。推送流程：

1. `git fetch origin`
2. `git log --oneline HEAD..origin/main`，确认远程只多了 manifest 提交；有其他提交先告知用户
3. `git rebase origin/main`
4. `git push origin main`

推送 `stable` 时同样操作，把 `main` 换成 `stable`。

### CDN 缓存

安装入口从 jsDelivr 的 `@main` / `@stable` 读取 `install.ps1` / `install.sh` / `dsh-tavern-runtime.json`（最长缓存 12 小时），代码文件却按清单里的提交号下载；旧安装脚本配新代码会报“安装文件不完整，缺少……”。

每次推送后，Publish runtime manifest 工作流会在发布新清单后自动刷新这三个文件的缓存，并等到 CDN 返回新清单。工作流出现 “jsDelivr still serves a stale manifest” 警告时，手动刷新：

```sh
b=main  # 或 stable
for f in install.ps1 install.sh dsh-tavern-runtime.json; do curl -s "https://purge.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/$f" >/dev/null; done
curl -s https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/dsh-tavern-runtime.json | grep revision
```

## 测试

### 自定义功能只保留最小单元测试

新增或维护自定义功能时，只测试实际业务行为：每项独立行为保留一个主要成功用例，以及会造成数据丢失、权限越界、重复发送或错误重试的必要边界。优先复用已有用例；不重复覆盖上游已有行为，不堆叠等价参数组合，不为简单转发接口、组件接线、按钮文案和实现结构单独写测试。

单元测试只依赖仓库源码、项目声明并由锁文件固定的依赖，以及测试自己创建并清理的临时数据。网络、存储、时钟等外部边界用内存替身隔离；这属于单元测试，不等于模拟整套应用。不得依赖项目外安装的 DSH、桌面客户端、ffmpeg、真实账号、代理、开放端口或现有用户数据，不借用正式运行时的依赖目录。已出现过的编辑器换行删除问题可使用项目依赖中的真实 Lexical 在内存 DOM 中验证，无需浏览器。

清理只针对自定义新增的冗余测试，不删除上游原有用例。已有上游测试因自定义接口变化所需的最小夹具或期望适配可以保留；不得为了绕过本机依赖问题而修改上游测试、注入新替身或跳过原有断言。

### 每次 custom 同步上游的固定检查

每次 rebase `upstream/main` 后，完整执行同一个固定入口：

```sh
node bin/test-custom-unit.mjs
# 等价的 pnpm 入口（项目依赖已安装）
pnpm test:sync:unit
```

原有 `pnpm test:custom:unit` 保留为同一入口的别名。清单在 `bin/test-custom-unit.mjs` 中分为 `upstreamUnits` 和 `customUnits`，当前固定运行 29 份上游兼容单元文件和 18 份自定义最小单元文件；共享文件中的自定义用例一并运行。上游组覆盖后台任务、会话与历史、分叉、开场、世界书、预设、正则、正文工具策略和 HTTP 来源校验，保留并运行这些文件内的全部上游用例。

每次都完整运行两组，不根据本次提交、冲突或“可能受影响的功能”临时筛选文件、用例或追加模拟回归。上游向已列文件增加的用例自动运行。只有功能或测试文件新增、删除、拆分、改名时维护清单，并保持对应上游兼容覆盖；不能为让检查通过而缩减清单。新增自定义功能同步登记最小单元。

默认不运行模拟整套应用、集成、真实子进程、浏览器、端到端、真实 DSH/NapCat/模型请求及需要外部媒体程序的测试。上游全量 `node bin/test-tavern.mjs` 留给明确要求的发布或专项验证，不作为同步门槛。客户端或模组源码有变更时按其已有构建脚本重建并检查产物一致性，不因此扩展测试范围。

依赖准备与测试分开：新工作树按各项目的锁文件安装依赖，再用上述 Node 入口运行；不通过外部安装目录或临时链接补齐缺包。入口不读取宿主运行时配置，并剔除继承的 `DSH_*`、`TAVERN_*`、`NODE_OPTIONS` 和 `NODE_PATH`。缺依赖、测试失败、取消或环境阻塞都必须如实报告，全部必要检查通过后才能报告同步完成。
