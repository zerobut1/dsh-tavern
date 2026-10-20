# 局域网访问电脑端酒馆

在 Mac 上运行 Tavern，让同一局域网内的 Windows 浏览器访问完整电脑界面。DSH 0.2.1 要求绑定具体网卡 IP，因此本功能不使用 `0.0.0.0`。

## 保存监听地址

在项目目录执行一次：

```sh
pnpm run lan:tavern
```

只有一个局域网 IPv4 地址时自动选中；存在多个地址时会列出网卡和地址，要求明确选择。例如：

```sh
pnpm run lan:tavern 192.168.1.123
```

此命令只保存配置，不启动、停止或重启服务。配置保存在当前安装的数据目录 `tavern-network.json` 中，CLI 默认位置是 `~/.dsh-tavern/tavern-network.json`；不会随 Git 提交或代码更新被覆盖。

## 启动与访问

```sh
pnpm run start:tavern
```

服务原先已运行时，使用下面的命令应用新地址：

```sh
pnpm run restart:tavern
```

启动器会直接打印局域网访问链接。把“打开网页（请复制完整地址）”后的整条链接复制到 Windows 浏览器，保留 `?token=…` 等参数。默认端口为 `3081`，被其他程序占用时可能自动使用其他端口，请以输出为准。这个入口显示完整电脑端界面；原有手机入口保持独立。

Mac 与 Windows 都使用输出的局域网链接。若不希望启动时自动打开 Mac 浏览器，可运行：

```sh
DSH_TAVERN_NO_OPEN=1 pnpm run start:tavern
```

服务独立运行，启动命令完成后可以关闭 SSH 窗口。Mac 必须保持唤醒，网络需允许两台机器互相访问；如果 macOS 询问 Node 是否接受传入连接，选择允许。带 token 的地址包含访问凭证，只用于自己的设备。

## 查看、更换或关闭

```sh
# 只查看已保存的配置和本机 IPv4 网卡，不启动服务
pnpm run lan:tavern --status

# 查看运行状态，重新取得当前服务的完整访问链接
pnpm run status:tavern

# 更换网络或 IP 后重新选择地址，再手动重启
pnpm run lan:tavern
pnpm run restart:tavern

# 恢复仅本机访问，再手动重启
pnpm run lan:tavern --off
pnpm run restart:tavern
```

新启动会检查保存的 IP 是否仍属于本机；IP 已变化时明确报错，不会静默切换地址。运行中服务的地址和端口记录在 PID 文件中，修改配置后仍可正确查状态和停止旧服务；旧 PID 文件继续按 `127.0.0.1` 处理。

也可临时覆盖配置：`DSH_TAVERN_BIND=<本机IPv4>` 指定地址；`DSH_TAVERN_LAN=1` 自动选择唯一局域网 IPv4，`DSH_TAVERN_LAN=0` 使用回环地址。优先级为 `DSH_TAVERN_BIND`、`DSH_TAVERN_LAN`、已保存配置、默认 `127.0.0.1`。临时环境变量不会修改保存的配置，已经运行的服务仍需手动重启才会改变监听地址。

## 验证范围

新增单元测试覆盖配置选择、旧 PID 兼容、实际地址和端口的链接验证、局域网同源请求与 DSH 鉴权、沙箱资源，以及 HTTP 环境下的请求 ID。测试使用内存替身和临时配置文件，不启动服务、浏览器或真实模型。Windows 跨设备访问由启动后实际验收。
