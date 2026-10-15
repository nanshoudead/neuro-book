---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.html-preview
owners:
  - nbook.html-preview
---

# HTML 预览

## 目标与非目标

内置插件 `nbook.html-preview` 向编辑器区贡献 HTML 文件的预览编辑器：`.html` 以源码打开，标题栏多一个“打开预览”，预览随正文（含未保存的修改）更新。预览里的脚本照常运行，但关在沙箱里：拿不到应用的数据与接口，只能读到这部作品里的文件；默认不能访问外网。

不承诺：

- Worker：沙箱页面不能用 http 地址建 Worker（可以用 `blob:`）。
- 页面自带 `<base>` 时以页面的为准，相对引用可能落不到文件所在目录。
- 跳到别的页面后的实时更新：页面里点链接跳到另一个 `.html`，显示的是它的磁盘内容。
- 独立源的预览（另开端口或 `*.localhost` 主机名）：开发者 2026-10-14 搁置。
- Markdown 的预览：Markdown 用富文本编辑。

## 术语与参与者

- **预览视图**、**预览编辑器**：见 [workbench.editor](editor.md) 的术语。
- **预览令牌**：[workspace.files](../workspace/files.md) 的“预览的受限读取”签发的只读凭据。

## 输入与前置条件

- 插件只有浏览器入口，激活事件 `onStartup`；依赖编辑器区的贡献点 `editor.editors` 与 `nbook.files` 的远程服务 `nbook.files.preview`。
- 声明：`{title: {"zh-CN": "HTML 预览", "en-US": "HTML Preview"}, selector: {extensions: ["html", "htm"]}, priority: "option", input: "text", role: "preview"}`，编辑器 id `nbook.html-preview.html`。打开方式见 [workbench.editor](editor.md) 输出 46–48。
- 只预览 `project://` 下的文件：`user://` 下的 HTML 预览视图说明“只能预览作品里的文件”。
- 命令 `nbook.editor.toggle-preview-network {}`（命令 id 的第二段是功能域 `editor`，[workbench.commands](commands.md) 的“命令身份”；`when`：活动编辑器是本编辑器；对 Agent 不开放），向编辑区标题贡献一个开关按钮“允许联网”（勾选态读公开键 `nbook.html-preview/networkAllowed`）。

## 输出与可观察行为

1. **沙箱**：预览页在 `<iframe sandbox="allow-scripts" srcdoc>` 里，只给 `allow-scripts`（不给 `allow-same-origin`、`allow-popups`、`allow-top-navigation`、`allow-forms`）。页面的源是不透明的：读不到应用的存储与页面，连不上 RPC（来源不被允许），向应用端口发的写请求被拒（[runtime.server-host](../runtime/server-host.md) 的“HTTP 端口的来源核对”），其它读请求拿不到响应。
2. **令牌**：预览视图可见时申请令牌（这部作品、窗口绑定的那一代），切走、不可见、标签关闭时作废，再次可见时重新申请；项目换代时服务端作废。令牌只出现在 `srcdoc` 里。
3. **相对引用**：`srcdoc` 是文档正文，开头插入：`<base href>`，指向文件所在目录在令牌下的地址；一段 CSP（见第 5 条）；一小段脚本，把 `#` 开头的链接点击改为页内滚动（否则按 `<base>` 会导航到目录地址）。于是页面按相对路径引用的图片、样式、脚本、模块脚本、`fetch`、字体都读到作品里的文件；`../` 可以往上，到作品根为止。
4. **更新**：正文变化停手 300 毫秒后整页重载；脚本里的状态随之丢失。正文没变时不重载。
5. **联网**：默认 CSP 只放行令牌地址、`data:`、`blob:` 与内联脚本和样式，页面不能把读到的内容发到外网，也加载不了 CDN 上的资源（包括向本应用端口发请求）。“允许联网”打开后去掉网络限制，按文件地址记在本窗口的内存里，刷新后回到不联网；预览随即重载。页面自己写的 CSP 与它取交集，只能更严。打开联网后预览页可以向本机端口发 GET（读不到响应）：开发模式的 Vite 有带副作用的 GET 入口，不要对不受信任的页面在开发模式里打开联网。
6. **不可见时卸载**：预览视图不可见（切到别的标签、所在组被别的编辑器占着）时移除 iframe，可见时重建；被换下的页面不在后台运行脚本。
7. **只读**：预览视图不接受输入，没有光标位置；它显示文档的 dirty 圆点，在它上面可以保存（[workbench.editor](editor.md) 输出 4）。

## 状态与转换

| 状态 | 进入 | 离开 |
|---|---|---|
| waiting | 可见且还没有令牌 | 拿到令牌为 shown；失败为 failed |
| shown | 拿到令牌、正文就绪 | 不可见或切走为 hidden（令牌作废） |
| hidden | 不可见 | 可见时回到 waiting（重新申请令牌、重建 iframe） |
| failed | 令牌申请失败（项目已关闭、断线） | 重试或可见时再申请 |

时序与寿命：

- 停手计时用注入的时钟；不可见期间不计时，重新可见时按当时的正文重建。
- 令牌的作废以服务端为准（窗口断开、项目这一代结束时服务端作废）；作废后页面里的请求得到 404，预览视图重新申请令牌后重载。

## 副作用与数据

不写文件与记录；“允许联网”只在本窗口的内存里。

## 失败与恢复

| 情形 | 表现 | 用户怎么办 |
|---|---|---|
| 不是 `project://` 的文件 | 内容区说明只能预览作品里的文件 | 关闭 |
| 令牌申请失败 | 内容区说明原因与“重试” | 重试 |
| 页面里的资源 404 | 由页面自己表现（浏览器控制台有记录） | 改正路径 |

## 边界与兼容

信任边界：预览页是不受信任的代码。它能读到这部作品里的文件（经令牌，只读），不能写文件，不能执行命令，默认不能联网；打开“允许联网”是用户对这个文件的明确授权。

## 验收与 Smoke

1. Given `site/index.html` 引用 `./a.png`、`./s.css`、`<script type="module" src="./m.js">`、`fetch("./d.json")`、`@font-face` 的 `./f.woff2` 与页内锚点，When 打开预览，Then 图片、样式、模块脚本、`fetch` 与字体都生效，点锚点在页内滚动、地址不变。
2. Given 预览页里的脚本，When 它读 `parent.document`、用 WebSocket 连 RPC 端口、向应用端口 `POST`、`fetch` 一个外网地址，Then 依次被拒、被拒、得到 403、被 CSP 拦下；When 打开“允许联网”，Then 外网请求可以发出。
3. Given 预览视图与源码在同一组，When 切到源码，Then iframe 被移除；When 在侧边打开预览、在源码里输入不保存，Then 停手后右侧的预览显示新内容；When 关闭预览标签，Then 它的令牌失效。

Smoke：`e2e/editor-types.e2e.ts`（生产构建、本机 Chrome、真实 Files）。

## 证据

- 批准依据：[w00025 t01 的决定](../../../.agents/works/w00025-editor/tasks/t01-requirements/README.md#开发者的决定) 2、3 与 [t02 实施计划](../../../.agents/works/w00025-editor/tasks/t02-editor-types/plan.md) 第 6 节（预览方式为开发者 2026-10-14 在计划审查后定的“沙箱加受限读文件接口”；默认不联网为暂定）。
- 实现入口：[`plugins/html-preview/web/plugin.ts`](../../../packages/neuro-book/src/plugins/html-preview/web/plugin.ts)、[`HtmlPreview.vue`](../../../packages/neuro-book/src/plugins/html-preview/web/components/HtmlPreview.vue)、[`compose.ts`](../../../packages/neuro-book/src/plugins/html-preview/web/compose.ts)、令牌服务与预览路由 [`files/backend/raw-route.ts`](../../../packages/neuro-book/src/plugins/files/backend/raw-route.ts)
- 合同测试：[`html-preview/compose.test.ts`](../../../packages/neuro-book/src/plugins/html-preview/compose.test.ts)、[`files/raw-route.test.ts`](../../../packages/neuro-book/src/plugins/files/raw-route.test.ts)（预览的受限读取）
- Smoke：[`e2e/editor-types.e2e.ts`](../../../packages/neuro-book/e2e/editor-types.e2e.ts)
