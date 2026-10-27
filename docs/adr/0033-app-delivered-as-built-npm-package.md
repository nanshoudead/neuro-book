---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-27
superseded-by: null
---

# ADR 0033：新应用发构建产物的 npm 包，带 `nbook` 命令；一个状态根一个实例

- 日期：2026-10-27
- 决策者：开发者（2026-10-24、2026-10-25 与 2026-10-27 的决定，见 [t15 第二期计划](../../.agents/works/w00027-plugin-platform/tasks/t15-author-api-round2/plan-phase2.md) 的 Context，D1 到 D4）
- 关联工作：[w00027 t15](../../.agents/works/w00027-plugin-platform/tasks/t15-author-api-round2/README.md)

## 背景

v2 分支删掉了旧应用的交付链（Windows zip、NeuroBook Manager、桌面版），新应用 `packages/neuro-book` 只能从源码 `bun run build` 后用环境变量启动。[ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 让工作区包以源码发到 npm，决定 6 明确不含新应用。插件 SDK 已能打成 tarball（[ADR 0030](0030-plugin-platform-layering.md)），作者构建的插件却只能经插件页安装，用户也没有启动应用的命令。

发行方向的审查（t15 的 `evidences/p2-direction-review-omp.txt`）实测：服务端产物（`main.js` 1.8 MB、`project.js` 1.6 MB）与 Web 产物运行时不需要 Vite 与 `node_modules`；`bun build --compile` 的单文件起不来项目子进程、读不了内嵌的 Web 产物；同一状态根上两个服务端会丢作品登记（40 次登记剩 20 条）。

## 决策

1. **发构建产物，不发源码**（补充 ADR 0029 决定 6）。npm 包 `@notnotype/neuro-book` 由 `scripts/pack-app.ts` 生成：`server/nbook.js`（命令行与整个服务端）、`server/project.js`、`web/`、`LICENSE`、给用户的 README、`THIRD-PARTY-NOTICES.md`。依赖全部打进 bundle，包没有 `dependencies`；应用的源码包保持 `private`，只有生成的目录能发布。与 SDK 包同一个版本号（产品版本）。
2. **应用包自带命令 `nbook`**，给用户与 Agent：第一版只有前台的 `start` 与插件管理 `plugin list/install/enable/disable/uninstall`（[`runtime.cli`](../specs/runtime/cli.md)）。作者的命令 `nbooke` 在 SDK 包里。npm 上的 `nbook` 是别人的包，文档只写 `bun add -g @notnotype/neuro-book`。
3. **状态根缺省是平台的数据目录**：Linux `$XDG_DATA_HOME/neuro-book`（缺省 `~/.local/share/neuro-book`）、macOS `~/Library/Application Support/NeuroBook`、Windows `%LOCALAPPDATA%\NeuroBook`；`--state-root` 与 `NBOOK_STATE_ROOT` 可以覆盖。缺省只在命令行这一层定，服务端进程仍要求显式的状态根。
4. **一个状态根同一时间只跑一个服务端**，用状态根派生地址上的本地套接字认领（同 VS Code 桌面端的 `claimInstance`，[`runtime.server-host`](../specs/runtime/server-host.md) 的“实例认领”）。套接字由内核持有：进程被暂停时不会被别人接管，崩溃后立即释放。否决锁目录加心跳：进程暂停超过心跳期限就被接管，同一状态根跑起两个实例（计划审查三位审查者实测）。第二次运行 `nbook` 打开已有实例。为“同一状态根多个服务端”做的插件版本租约随之删除。
5. **`nbook start` 前台运行**，终端拥有服务的寿命，关闭终端（SIGHUP）也走有序停止。后台运行（注册成系统服务，`nbook service …`）另行设计：先调研现成的库，没有就做成一个包。
6. **发行按两个维度另写提案**：运行时来自用户的 Bun（本 ADR 的 npm 包）或随发行捆绑的 Bun（目录包）；界面在浏览器、浏览器安装的独立窗口或原生窗口（桌面壳，在 Electrobun、Tauri、Electron 里实测后选，都把 Bun 当独立进程、窗口加载回环的页面）。服务器部署（Docker、远端访问）以鉴权为前提另写提案。
7. **不恢复旧 Manager**。它的几项能力的去向：多实例改为各用一个状态根；Windows 一键启动由目录包或桌面壳承担；源码构建是开发者的 `bun run build`；Docker 归服务器部署提案；卡死后的自动重启归后台运行。

## 后果

- 用户要先装 Bun。`npm i -g` 也能装上，但没有 Bun 时只看到 shell 的 `env: bun: No such file or directory`；`engines.bun` 不拦任何安装，`nbook` 入口自己核对版本。
- 全局包原地升级会在运行中的服务端脚下换掉文件：服务端拉起项目子进程前核对 `project.js`，变了就拒绝；`nbook start` 遇到版本不同的实例时报错。页面资源的同类问题留作后续。
- 包里的代码是 bundle，AGPL 的源码以仓库地址与构建所用的提交提供（包的 README）；第三方许可靠 `THIRD-PARTY-NOTICES.md` 履行。
- Windows 与 macOS 未实测：命名管道的认领在 Bun 上有失败的报告，新应用在 Windows 上整体未验证。
- 接进 `release:publish`、真正发布、两个包的发布顺序与半途失败在 t15 第三期处理。
