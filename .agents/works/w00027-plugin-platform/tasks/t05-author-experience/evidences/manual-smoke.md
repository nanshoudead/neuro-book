# 手动 smoke：照作者文档在仓库外写一个插件

2026-10-23，Work 分支 `c11de13bd`（含 S4 合入）。Node v26.10.0，npm 走真实网络（经 `prox`）。

## 步骤与结果

照 SDK 包 `README.md` 的“安装 SDK，生成插件”字面执行：

1. 仓库里 `bun scripts/plugin-sdk/build-sdk.ts <目录>`，在输出目录 `npm pack`，得到 `notnotype-nb-plugin-sdk-0.1.0.tgz`（36 个文件）。
2. 新目录 `hello`：`npm install -D ../notnotype-nb-plugin-sdk-0.1.0.tgz`，11 秒装好 45 个包；`package.json` 只有 SDK 的 `file:` 依赖。
3. `npx nbook-plugin create . --publisher acme`：生成 `acme.hello`，打印下一步；`package.json` 里 SDK 的 `file:` 写法保留。
4. `npm install`（补装模板的依赖）、`npm run typecheck`（vue-tsc，无输出）、`npm run build`：产物 `browser.js`、`browser.js.map`、`package.json`、`style.css`。
5. `nbdev dev start --sample` 起开发服务，在设置窗口的插件页“安装…”填 `dist` 的路径，插件行显示“重启后安装”；`nbdev dev stop` 再起，侧栏出现模板的视图，显示设置里的问候语“你好”与计数（[截图](../artifacts/smoke/installed.webp)）。
6. 开发循环：改 `web/HelloView.vue` 的一行文字，`npm run dev` 构建出 `0.1.0+dev.20261023175538.320`；插件页再装一次，确认框写“升级插件 acme.hello 0.1.0 → 0.1.0+dev.…”，没有降级提示；重启后视图显示新文字（[截图](../artifacts/smoke/dev-upgrade.webp)）。

## 发现

- 第三方插件的侧栏视图排在了内置资源管理器前面，工作台打开时侧栏显示的是插件的视图。没写 `order` 的视图按 0 排，同值按 id 排，资源管理器也是 0，`acme.*`、`my.*` 这类 id 就排在 `nbook.*` 前面。是否该把第三方视图排到内置之后，交开发者定（记进 Work 的待确认清单）。
- worktree 的开发状态根（`packages/neuro-book/.dev-state`）里留着装上的 `acme.hello`（开发版），没有卸载。
