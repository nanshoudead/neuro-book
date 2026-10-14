# t02 实施计划：按文件类型选编辑器

第二版（2026-10-14）：按 Opus 计划审查（`evidences/design-review-opus.txt`，20 条）修订。第 6 节 HTML 预览的“源”待开发者定（见第 6 节开头）。

## Context

- **为什么做**：开发者 2026-10-14 定下编辑器 Work 的第一段：像 VS Code 那样按文件类型选编辑器，图片能看、文本按语言高亮、HTML 能预览；之后再深度打磨 Markdown（[t01 的决定](../t01-requirements/README.md#开发者的决定) 1–6）。
- **现状**（[t01 的差距](../t01-requirements/README.md#基础架构与现状的差距)）：编辑器种类写死为 `markdown | code`（`editor/web/groups/groups.ts` 的 `FileEditorKind`，`area.ts` 的 `defaultEditor`）；文件只能经 RPC 读 UTF-8 文本，正文上限约 960 KiB（`workspace/files.md` 的“读取与保存”）；Monaco 在 `editor/web/code/load-monaco.ts` 里直接引入 8 种语言；没有预览。
- **开发者已确认**（t01 决定 2–6，与计划第一版的两点）：
  - 预览有两种打开方式：“打开预览”默认在当前组，另有“在侧边打开预览”；
  - HTML 预览运行脚本，关在沙箱里：拿不到应用的数据与接口，只能读到页面按相对路径引用的文件；
  - 非文本只做 png、jpg、gif、webp、svg，只看不改，SVG 默认按图片显示、可用源码编辑器重新打开；PDF、音视频、字体显示“不能在这里打开”；
  - 编辑器按顺序选：声明了这类文件的编辑器 → 默认文本编辑器 → 不支持；
  - 语言模式这期做语言登记、高亮与编辑规则两层，只实现 Monarch；TextMate 与 Vue 语言插件放进第三方插件 Work；LSP 暂缓；
  - 图片查看器与 HTML 预览做成两个独立的内置插件；界面不出评审稿，验收时给截图；审查走快速审查。
- **依据**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)（声明与交付两层）、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/quick-open.md`](../../../../../docs/specs/workbench/quick-open.md) 的选择模式。
- **工作方式**：worktree `.worktree/w00025-t02-editor-types`（分支 `feat/w00025-t02-editor-types`），主会话编码；逐片自跑验证、单独提交、只暂存本片文件。测试用真实插件宿主、真实 Files 与真实浏览器，不用 mock、假计时器、固定等待。不改 `packages/neuro-book-legacy`。

## 术语

- **preview 标签**：沿用现有含义，单击打开、会被下一次单击替换的标签（`EditorTab.preview`）。
- **预览编辑器**：本计划新增，声明了 `role: "preview"` 的编辑器（HTML 预览）。它打开的标签叫“预览视图”。两者在 Spec、代码与测试名里不混用。

## 关键设计

### 1. 编辑器贡献点 `editor.editors`（`editor/shared/contracts.ts`、`editor/web/editors.ts`）

- **声明**（静态，进清单）：`{title, selector: {extensions?: string[], filenames?: string[]}, priority: "default" | "option", input: "text" | "bytes", role?: "preview", cursor?: "offset" | "line"}`。
  - 贡献 id 就是编辑器 id，规则与页面 id 相同（点分小写，内置以 `nbook.` 开头），所以不会与页面撞名。
  - `cursor` 声明光标的写法，没有就不记光标；`cursorFits` 按声明判断，不再写死 `markdown`。
- **实现**：`{load(): Promise<Component>}`。组件按公开的控件合同接收绑定（第 8 节）。
- **内置**：`nbook.editor` 贡献 `nbook.editor.markdown`（default，`.md`、`.markdown`，`cursor: "offset"`）与 `nbook.editor.code`（文本编辑器，没有 selector，兜底；`cursor: "line"`）。这两个的组件由编辑器区直接引用、不等交付：编辑器区在 `activate` 里就建好并开始恢复会话，比自己的交付早。
- **选择顺序**（`editors.ts` 的 `resolveEditor(address, declarations)`，纯函数）：
  1. 调用方给的 `editor`：必须是已接受声明的 id，否则 `unavailable`；`input: "bytes"` 的编辑器只接受 selector 命中的文件，`input: "text"` 的可以打开任意文本；
  2. 扩展名属于已知二进制表（pdf、mp3、mp4、mov、webm、wav、flac、ogg、ttf、otf、woff、woff2、zip、gz、7z、exe 等），且没有编辑器认领：显示“不能在这里打开”，不发读取；
  3. `priority: "default"`、selector 命中的声明：文件名命中优先于扩展名，扩展名取最长的已登记后缀，匹配不区分大小写；同级有两个时取先登记的并记诊断；
  4. `nbook.editor.code`；它读到 `not-text` 时显示“这个文件不是 UTF-8 文本（可能是二进制文件或其它编码），不能在这里打开”，没有“重试”。编码转换不在本期。
- **只看声明**：选择只看已接受的声明，不看交付状态，结果不随插件激活先后变化。标签渲染分三种：声明不在（贡献方停止、没装）显示“这个编辑器已经不在了”与“用默认编辑器打开”；已声明、未交付显示进度（沿用输出 6 的 800ms 规则）；已交付则渲染。
- **用其它编辑器重新打开**：不带参数时经 `quickPickKey` 弹出候选（selector 命中的全部编辑器，加 `nbook.editor.code`），选中后换；带 `editor` 时直接换。
- **会话记录**：`editor` 字段改为编辑器 id 的字符串模式；读到旧值 `markdown`、`code` 时换成新 id，版本仍为 1。旧版本代码读到新 id 会把记录判为损坏、保护原件并从空组开始，这只在降级时发生，Spec 写明。

### 2. 标签模型（`editor/web/groups/groups.ts`、`area.ts`）

- **判别联合**：`EditorTab` 改为 `{kind: "page", page}` 与 `{kind: "file", address, editor: EditorId, preview, cursor?, language?}` 两种，`EditorId` 是品牌字符串。现有十几处 `editor === "page"` 改为按 `kind` 判别。
- **身份**：文件标签按“地址 + 编辑器”区分，同一组里 `a.html` 的源码与预览视图可以并存。
- **打开**：
  - 不指定编辑器时：本组有这个地址、编辑器不是预览编辑器的标签（不论是不是 preview 标签）就激活它，`permanent` 时转正；没有就按第 1 节选编辑器、新开。声明已不在的编辑器算作非预览编辑器。
  - 指定编辑器时按“地址 + 编辑器”匹配。
- **换编辑器**：要换成的编辑器在本组已有同一地址的标签时，切过去并关掉当前这个。`language` 与光标一样，随拆分复制、换编辑器时丢弃。
- **关闭询问（输出 4）**：“文档仍在别处打开时不问”改为“还有别的可编辑标签时不问”，预览视图与只读编辑器不算；预览视图显示 dirty 圆点，`save` 可用。

### 3. 文件条目：文本与字节共用一份生命周期（`editor/web/documents/store.ts`）

- **为什么不另起一套**：改名、删除、外部删除、资源管理器的租约 `moved` 与 `coordinator.close` 都由文档仓库按地址产生 `rebound`、`closed` 事件，去重（`displaced`）与 `kept` 判定也在那里。字节标签另起订阅会绕过这些，导致删除不关标签、改名后出现重复标签。
- **做法**：仓库仍按地址一份条目。`acquire(address, {text: boolean})`：
  - 有文本引用时才读正文（现有流程）；只有字节引用的条目不读，状态直接是 `ready`，正文为空且不 dirty，`writable` 为假；
  - 条目新增 `version`：磁盘上这个文件每有一次变化就加一；字节控件据此重新取；
  - 已有字节引用的条目又来了文本引用，就开始读正文；文本引用都释放后回到不读的状态。
- **编辑器区**：`referenceOf`、`binding`、`documentOf`、`releaseTab`、`openDocuments` 按标签的 `input` 取文本或字节引用。字节标签的绑定是第 8 节的 `BytesEditorBinding`，视图状态的槽键仍是“组 × 编辑器 × documentId”。
- **公开状态**：`active` 改为“有活动的文件标签且控件交出了句柄”，不再要求文本文档，所以关闭、拆分、重新打开在图片标签上照常可用；新增 `nbook.editor/activeEditor`（活动标签的编辑器 id，页面或空组为空串）；`writable`、`dirty`、`hasCursorPosition` 在字节标签上为假；终态抢救只列文本。

### 4. 字节读取（`files/backend/raw-route.ts`、`files/web/client.ts`）

- **路由**：`nbook.files` 的 server 入口贡献 `http.routes`：`GET /api/nbook.files/raw/project/<项目 id>/<代次>/<路径…>` 与 `GET /api/nbook.files/raw/user/<路径…>`。
- **项目根**：只服务正在运行的代次。服务端经 `projectsKey.list()` 核对 id 与代次（不符为 410）；该代次第一次请求时 `openRoot` 并缓存，`list()` 看到代次变了就丢弃重开；每次打开时核对身份文件里的 id 与登记一致（同封面路由的 `readMetadata`）。这样与项目子进程里的文件服务看到同一个根、同一套规则；没有运行的项目读不到，与 `files.md` 的“只用有效 ready 绑定”一致。
- **读法**：`rooted.read(path, maxBytes)`，上限 32 MiB，超过为 413 `too-large`。
- **状态码**：`not-found`、`not-a-file`、`invalid-address`、`outside-root`、`protected-path` 一律 404（不区分受保护与不存在）；`permission-denied` 403；`root-gone` 410；`io-failed` 500。错误体用分发器自己的 `{error: {code, message}}`。
- **响应头**：按扩展名的白名单给 `Content-Type`，其它 `application/octet-stream`；`X-Content-Type-Options: nosniff`；`Content-Security-Policy: sandbox`；`ETag`（修改时间加大小）与 `If-None-Match` 的 304；`Cache-Control: no-cache`。
- **跨站读取**：浏览器的请求带 `Sec-Fetch-Site` 且不是 `same-origin` 时返回 403，别的网页不能把这条路由当作读取接口。
- **浏览器端**：文件客户端加 `rawUrl(address)`，按窗口绑定的项目与代次拼地址；没有绑定、地址不是 `project://` 或 `user://` 时为 null。

### 5. HTTP 端口核对 `Host` 与写请求的 `Origin`（`http/backend/dispatch.ts`、`server/plugins.ts`、`http/backend/plugin.ts`）

- **Host**：未加载鉴权时，`Host` 必须是回环名（`127.0.0.1`、`localhost`、`[::1]`）或 `NBOOK_ALLOWED_ORIGINS` 里的主机，否则 421，放在分发最前面、所有路由都适用。防 DNS 重绑定：重绑定后攻击页与本机端口同源、GET 不带 `Origin`，只有 `Host` 能分辨。
- **Origin**：`GET`、`HEAD` 以外的请求带了 `Origin` 且不在允许的来源里（含 `null`）时 403。不带 `Origin` 的本机进程照旧放行（鉴权上线前已写明的限制）。
- **接线**：`allowOrigin` 现在是 `server/start.ts` 里的闭包，经 `ServerPluginContext` 传给 `createHttpPlugin`，再交给 `createDispatcher`；403 与 421 用分发器的 `errorResponse`。审查已核实开发代理、e2e 与测试里的请求都不会被误伤。

### 6. HTML 预览 `nbook.html-preview`（`plugins/html-preview/`）

**待开发者定：预览页放在哪个源。** 审查实测：沙箱 iframe（不透明源）里，图片、普通脚本、样式表能按相对路径加载；模块脚本、`fetch`、字体、Worker 都走 CORS，全部失败。要让它们成功，就得给字节路由开通配的 CORS，那等于让任何网页都能读文件。两种做法：

- **A. 独立源（推荐，VS Code 的做法）**：
  - 服务端另开一个只服务预览的回环端口。浏览器经远程服务 `nbook.files.preview` 申请一个令牌，令牌只放行这部作品；窗口断开时令牌作废（按调用方门面的寿命）。
  - iframe 用 `src` 指向 `http://127.0.0.1:<预览端口>/<令牌>/<文件路径>`，文档本身就在文件所在目录的地址上。相对引用、模块脚本、`fetch`、字体、页内锚点都能正常工作。
  - 未保存的正文由浏览器经同一个远程服务推给服务端，预览端口对这个文件返回推来的正文，对其它文件返回磁盘内容。
  - 预览源与应用不同源：RPC 按 `Origin` 拒绝它；应用端口的写请求被第 5 节拒绝；应用端口的读请求拿不到响应（没有 CORS 头）。
  - 代价：`server-host.md` 多一个端口（与 HTTP、RPC 端口同样的顺延规则）。
- **B. 不透明源 + `srcdoc`**（计划第一版）：只支持图片、普通脚本、样式表；模块脚本、`fetch`、字体不可用，写进 Spec 的已知限制。页内锚点要靠注入脚本拦截；Chrome 还会先按应用根目录多请求一遍每个相对资源。

两种做法下共同的部分：

- **声明**：`priority: "option"`，`role: "preview"`，`input: "text"`，扩展名 html、htm。激活事件 `onStartup`。
- **更新**：正文变化停手 300ms 后整页重载（脚本状态会丢，与 VS Code 的 Live Preview 一样），计时用注入的时钟。
- **不可见时卸载**：绑定为 null 或不可见时移除 iframe，重新可见时重建，被换下的预览页不在后台跑脚本。
- **导航**：不给 `allow-popups`、`allow-top-navigation`；页面里跳到别的 `.html` 显示磁盘内容，正文变化时回到当前文件，Spec 写明。

### 7. 图片查看器 `nbook.image-viewer`（`plugins/image-viewer/`）

- 声明：`priority: "default"`，`input: "bytes"`，扩展名 png、jpg、jpeg、gif、webp、svg。激活事件 `onStartup`。
- 取图：`fetch(binding.url)` 取 blob 再生成对象 URL，能知道字节数，也能把 404、410 之类的原因写出来；`version` 变了重新取；SVG 经 `<img>` 显示，里面的脚本不运行。
- 显示：默认适应窗口、只缩小不放大；点一下在“适应”和“100%”之间切换，Ctrl + 滚轮缩放；透明部分用棋盘格底。
- 状态：像素尺寸与文件大小经句柄的 `status` 交给编辑器区（第 8 节），由通用的状态栏条目显示。

### 8. 公开的控件合同（`editor/shared/contracts.ts`）

- 现在的 `ViewBinding`、`EditorControlHandle` 在 `editor/web/area.ts`，`ViewBinding.document` 是内部的 `TextDocument`。别的插件运行时只能引 `shared/contracts.ts`（`architecture.test.ts` 会检查），所以把控件合同挪进去：
  - `TextEditorBinding`：文档的只读视图（正文、修订、状态、writable）加 `commit`、`attach`、`unresolved`、`cursor`、`remember`，不暴露 `saving`、`conflict` 等内部状态；
  - `BytesEditorBinding`：`{address, url, version}`；
  - `EditorControlHandle` 加 `status?: Readonly<Ref<LocalizedText | null>>`；新的状态栏条目 `nbook.editor.editor-status`（`when: active`）显示活动控件交出的这一行。
- 内置的 Markdown 与源码控件也改用这份合同。

### 9. 语言贡献点 `editor.languages`（`editor/shared/contracts.ts`、`editor/web/code/`）

- **声明**：贡献 id 是语言 id，内容是 `{aliases, extensions?, filenames?, firstLine?, mimetypes?}`，与 Monaco 的 `registerLanguage` 同一套字段。
- **实现**：`{load(): Promise<{format: "monarch", language, configuration}>}`；`format` 这期只有 `monarch`，Spec 写明 `textmate` 留给第三方插件 Work。
- **注册**：Monaco 加载时一次性 `languages.register` 全部已接受的声明，每门语言用 `registerTokensProviderFactory` 按需建分词器、`onLanguageEncountered` 时设 `configuration`，与 Monaco 自己的 `registerLanguage` 一样。这样 HTML 里的 `<script>`、`<style>` 与 Markdown 的代码块能按 `nextEmbedded` 找到并加载嵌入语言。建模型用 `createModel(text, language, uri)`：标签记着语言就用它，否则交给 Monaco 按文件名与首行识别。
- **内置**：`nbook.editor` 登记 Monaco 0.55 自带的全部 basic-languages。表由脚本解析 `basic-languages/*/*.contribution.js` 里的每个 `registerLanguage({...})` 调用生成，保留原来的 `loader` 表达式（例如 freemarker2 一个文件登记 6 门语言，导出不是统一的形状）。一条测试核对表与已装的 Monaco 一致。JSON 仍用 Monaco 的语言服务与 worker。`load-monaco.ts` 去掉直接引入的语言。
- **状态栏**：条目 `nbook.editor.language`，`when` 为活动编辑器是 `nbook.editor.code`，显示语言名。点它执行 `nbook.editor.change-language`，经 `quickPickKey` 列出全部语言，选中后换当前模型的语言并记在标签上（会话记录可选字段 `language`）。记下的语言恢复时已不在：回退到自动识别，不改写记录。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/editor.md` | 术语（preview 标签与预览编辑器）；`open` 的 `editor` 为编辑器 id 及失败；输出 1、4 按第 2 节改；输出 19–20 改为选择顺序与重新打开的选择；新增“编辑器贡献”“文件条目与字节标签”“预览”“语言”几节、公开键 `activeEditor`、状态栏的语言与编辑器状态条目；会话记录的字段与降级行为；“边界与兼容”删掉“只有两种”；补验收场景 |
| `docs/specs/workbench/image-viewer.md`（新） | 图片查看器的行为与验收 |
| `docs/specs/workbench/html-preview.md`（新） | 预览的源、令牌与寿命、相对引用、更新、不可见时卸载、导航、安全边界、验收 |
| `docs/specs/workspace/files.md` | 新增“按地址读取字节”：路由、只服务运行中的代次、上限、状态码、响应头、跨站读取；选 A 时加预览令牌服务 |
| `docs/specs/runtime/server-host.md` | HTTP 的 `Host` 与写请求 `Origin` 核对、场景 12 增补；选 A 时加预览端口 |
| `docs/specs/README.md` 注册表 | 两份新 Spec |
| 组件同名 `.md` | `EditorGroup.md`、`EditorArea.md`、`MonacoControl.md`、`MarkdownControl.md`；新组件先写 `.md` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | Spec 与注册表 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 4、5 节 | 字节路由、`rawUrl`、`Host` 与 `Origin` 核对 | `bun run test:affected --typecheck` |
| S2 | 第 1、2、8 节 | 编辑器贡献点、选择顺序、标签判别联合与身份、会话记录、重新打开的选择、公开控件合同 | 同上；`editor-area.e2e.ts` 除“用其它编辑器重新打开”一例外原样通过，那一例改为选择 |
| S3 | 第 3 节 | 文件条目的文本与字节引用、`version`、公开状态 `active` 与 `activeEditor`、编辑器状态条目 | 同上 |
| S4 | 第 7 节 | `nbook.image-viewer`、Lab 场景 | 同上；`lab:shot` |
| S5 | 第 6 节 | `nbook.html-preview`（选 A 时含预览端口与令牌服务）、预览命令与标题动作、Lab 场景 | 同上；`lab:shot` |
| S6 | 第 9 节 | 语言贡献点、生成的语言表、语言条目与切换 | 同上 |
| S7 | — | e2e、Spec 的实现合同与证据、实现审查与修正 | 下面“验证” |

## 验收映射

| 行为 | 测试 |
|---|---|
| 选择顺序：指定（未知 id、字节编辑器开不匹配的文件都失败）→ 已知二进制 → default 声明（文件名优先、最长后缀、不分大小写、同级取先登记并诊断）→ 源码；不是 UTF-8 时的说明 | `editor/editors.test.ts`；`area.test.ts` 增补 |
| 只看声明：贡献方未交付时标签显示进度、交付后渲染；声明不在时显示“已经不在了”与“用默认编辑器打开” | `area.test.ts`（真实插件宿主，交付先后两种顺序） |
| 同组里源码与预览视图并存；不指定编辑器的打开激活非预览编辑器的标签（preview 标签照旧被替换）；换编辑器撞上已有标签时切过去；关掉 dirty 的源码标签、只剩预览视图时照常询问 | `groups.test.ts`、`area.test.ts` 增补 |
| 字节标签：资源管理器删除后标签关闭；改名后跟过去且不重复；外部改写后 `version` 加一；Ctrl+W、拆分、重新打开可用 | `area.test.ts`、`documents.test.ts` 增补 |
| 字节路由：两个根；代次不符 410；身份文件不符被拒；白名单类型与三个响应头；越界、受保护、目录一律 404；超上限 413；304；跨站 403 | `files/raw-route.test.ts`（真实临时目录、真实 HTTP 分发） |
| `Host` 不是回环名 421；写请求带不允许的 `Origin`（含 `null`）403；GET 与不带 `Origin` 的照旧 | `http/backend/dispatch.test.ts` 增补 |
| 图片：png 与 svg 显示、状态栏有尺寸与大小、外部改写后刷新、2 MB 的 pdf 显示不能在这里打开 | `e2e/editor-types.e2e.ts` |
| 预览：标题有“打开预览”、在当前组开；“在侧边打开预览”开到右侧；改正文不保存、停手后更新；相对引用的图片显示；预览里的脚本运行；读不到 `parent.document`、连 RPC 被拒、向应用端口 `POST` 得 403；切走后 iframe 移除。选 A 另验模块脚本、`fetch`、页内锚点 | `e2e/editor-types.e2e.ts` |
| 语言：`.py`、`.go`、`.rs` 有高亮；`a.html` 的 `<script>` 与 Markdown 的 ```` ```ts ```` 代码块有嵌入语言的 token；状态栏显示语言名；切换后高亮随之变化、刷新后保留；语言表与已装 Monaco 一致 | `e2e/editor-types.e2e.ts`；`editor/web/code/languages.test.ts` |
| 现有行为不变 | `editor-area.e2e.ts`、`welcome.e2e.ts`、`bookshelf-stats.e2e.ts`、`lab-editor.e2e.ts`，以及编辑器的 Bun 测试 |

## 验证

- 每片：`bun run test:affected --typecheck`；改到 Lab 夹具时对该组件跑 `lab:shot`。
- 收口：生产构建后跑上表的 e2e（本机 Chrome、真实 Files），在 390px 与 1400px 宽下看图片查看器和预览视图，明暗两种主题各看一次。
- 审查（快速）：前端（S2–S6 的界面与组件）派 Sonnet；后端（S1 的路由与核对、S3 的文件条目、选 A 时的预览端口）开 omp 会话，再加一个 Opus。
- 留下的未验证边界：Windows 与 macOS 上的路径与符号链接规则（与 `workspace/files.md` 已写的限制相同）；Firefox 与 Safari 上的沙箱行为；超大图片的内存占用不做测量。

## 不做

- TextMate 语法、Vue 等语言插件（第三方插件 Work）；LSP（暂缓）。
- PDF、音视频、字体的查看；图片编辑；非 UTF-8 文本的编码转换。
- Markdown 预览：Markdown 本来就是富文本编辑，这期不加。
- 第三方插件使用 `editor.editors` 与 `editor.languages` 的公开说明与例子（第三方插件 Work）。这期的合同写进 Spec，只给内置插件用。

## 风险

- 标签判别联合与“地址 + 编辑器”的身份碰到打开、拆分、改名、会话恢复、继续写作几条路径：S2 先让现有 `groups.test.ts`、`area.test.ts` 与 `editor-area.e2e.ts` 通过，再加新路径。
- 文件条目分出文本与字节引用，改的是文档仓库的读取时机：`documents.test.ts` 的现有用例必须原样通过；新增“只有字节引用时不读”“文本引用后来才来”两例。
- 页面自带 `<base>` 时以页面的为准（选 B 时），写进 Spec 的已知限制。
