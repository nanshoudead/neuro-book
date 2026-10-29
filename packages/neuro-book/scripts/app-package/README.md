<img src="https://raw.githubusercontent.com/notnotype/neuro-book/master/docs/images/readme/neurobook-lockup-horizontal-color.svg" width="360" alt="NeuroBook" />

# NeuroBook

本地优先的长篇写作工作区：作品是你电脑上的文件夹，章节与设定都是 Markdown 文件，数据都在你自己的机器上。这个包是 NeuroBook 应用本身，带命令 `nbook`。

这是 v2 的预览版：工作台、文件与编辑器、设置与插件已经能用，AI 写作、世界引擎与剧情工坊还在重建，见[仓库首页的路线图](https://github.com/notnotype/neuro-book#路线图)。

## 安装

需要 [Bun](https://bun.sh) {{bun}}。NeuroBook 只在 Bun 上运行，不能用 Node 运行。

```sh
bun add -g @notnotype/neuro-book
```

装完之后命令是 `nbook`。不要运行 `bunx nbook`：npm 上叫 `nbook` 的是别人的包。

## 启动

```sh
nbook
```

在前台启动本地服务、打开浏览器；按 Ctrl-C 停止。再运行一次 `nbook` 会打开已经在运行的那个。

- `--no-open`：不打开浏览器，只打印地址。
- `--port <端口>`：换 HTTP 端口。不给时用 4217，被占用会自动顺延到下一组；给了的端口被占用时启动失败。
- `--safe-mode`：不加载第三方插件，插件拖垮启动时用它进来再禁用或卸载。
- `--json`：结果以一个 JSON 对象写到标准输出，给脚本与 Agent 用。

服务只监听本机回环地址。在远程机器上运行时，用 `ssh -L 4217:127.0.0.1:4217 <机器>` 转发后在本机打开。

## 数据放在哪里

状态（设置、日志、插件、作品登记）放在平台的数据目录：Linux 是 `~/.local/share/neuro-book`（遵守 `XDG_DATA_HOME`），macOS 是 `~/Library/Application Support/NeuroBook`，Windows 是 `%LOCALAPPDATA%\NeuroBook`。用 `--state-root <目录>` 或环境变量 `NBOOK_STATE_ROOT` 换一个；一个状态根同一时间只跑一个 NeuroBook。作品目录缺省在你的文档目录下的 `NeuroBook`（系统没有文档目录时在主目录下，即 `~/NeuroBook`），设置窗口的“作品”分区里可以改。

## 插件

```sh
nbook plugin list
nbook plugin install <插件的 dist 目录>
nbook plugin disable <id>
nbook plugin uninstall <id>
```

插件完全受信任：装上之后它能访问全部作品、服务器与本机资源，只装你信任的来源。安装、启停与卸载都写进登记表，重启 NeuroBook 后生效。写插件用 SDK 包 `@notnotype/nb-plugin-sdk`：`bunx -p @notnotype/nb-plugin-sdk nbooke create my-plugin` 生成一个能直接构建的插件，作者文档随 SDK 包分发。

## 升级

先停掉运行中的 NeuroBook（在它的终端按 Ctrl-C），再 `bun add -g @notnotype/neuro-book@latest`。运行中升级会在它脚下换掉文件：已经在运行的那个打不开新的作品，`nbook` 也会提示版本不同。

## 许可

AGPL-3.0-only，见 `LICENSE`。这个包里是构建产物；对应的源码在 <https://github.com/notnotype/neuro-book>，构建所用的提交是 `{{commit}}`（目录 `packages/neuro-book`）。随包分发的第三方代码与字体的许可见 `THIRD-PARTY-NOTICES.md`。
