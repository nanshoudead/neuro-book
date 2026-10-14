# t02 实施计划：按文件类型选编辑器

## Context

- **为什么做**：开发者 2026-10-14 定下编辑器 Work 的第一段：像 VS Code 那样按文件类型选编辑器，图片能看、文本按语言高亮、HTML 能预览；之后再深度打磨 Markdown（[t01 的决定](../t01-requirements/README.md#开发者的决定) 1–6）。
- **现状**（[t01 的差距](../t01-requirements/README.md#基础架构与现状的差距)）：编辑器种类写死为 `markdown | code`（`editor/web/groups/groups.ts` 的 `FileEditorKind`，`area.ts` 的 `defaultEditor` 按 `.md` 二选一）；文件只能经 RPC 读 UTF-8 文本（`workspace/files.md` 的“读取与保存”），图片是 `not-text`；Monaco 在 `editor/web/code/load-monaco.ts` 里直接引入 8 种语言；没有预览。
- **开发者已确认**（t01 决定 2–6）：
  - 预览有两种打开方式，“打开预览”默认在当前组，另有“在侧边打开预览”；
  - HTML 预览运行脚本，关在不同源的沙箱里；
  - 非文本只做 png、jpg、gif、webp、svg，只看不改，SVG 默认按图片显示、可用源码编辑器重新打开，其余二进制显示“不能在这里打开”；
  - 编辑器按顺序选：声明了这类文件的编辑器 → 默认文本编辑器 → 不支持；
  - 语言模式这期只做“语言登记”和“高亮与编辑规则”两层，只实现 Monarch；TextMate、Vue 语言插件放进第三方插件 Work；LSP 暂缓。
- **依据**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/quick-open.md`](../../../../../docs/specs/workbench/quick-open.md) 的选择模式。
- **工作方式**：worktree `.worktree/w00025-t02-editor-types`（分支 `feat/w00025-t02-editor-types`），主会话编码；逐片自跑验证、单独提交、只暂存本片文件。测试用真实插件宿主、真实 Files 与真实浏览器，不用 mock、假计时器、固定等待。不改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 编辑器贡献点 `editor.editors`（`plugins/editor/shared/contracts.ts`、`editor/web/editors.ts`）

- **声明**（静态，进清单）：`{title, selector: {extensions?: string[], filenames?: string[]}, priority: "default" | "option", input: "text" | "bytes", preview?: boolean}`。贡献 id 就是编辑器 id，写进标签与会话记录。
- **实现**：`{load(): Promise<Component>}`，组件按控件合同（`editor/web/control.ts`）接收绑定；`input: "bytes"` 的控件收到第 2 节的字节绑定，不是文本文档。
- **内置**：`nbook.editor` 自己贡献 `markdown`（default，`.md`、`.markdown`）与 `code`（文本编辑器，不写 selector，作为兜底）。id 沿用 `markdown`、`code`，旧的会话记录照样合法。
- **选择顺序**（`editors.ts` 的 `resolveEditor(address)`，纯函数、可单测）：
  1. 调用方给的 `editor`；
  2. `priority: "default"`、selector 命中的贡献：文件名命中优先于扩展名；同级有两个时取先登记的，并记一条诊断；
  3. `code`；
  4. `code` 读到 `not-text` 时，内容区显示“这是二进制文件，不能在这里打开”，没有“重试”。
- **用其它编辑器重新打开**：列出 selector 命中的全部编辑器（含 option 档）加 `code`，经选择服务 `quickPickKey` 让用户挑。`reopen-with {editor}` 给了参数时直接换；没给时弹选择，不再在两种之间来回切。
- **标签找不到编辑器**（贡献方停止、会话记录里的编辑器没装）：内容区说明“这个编辑器已经不在了”，给一个“用默认编辑器打开”。做法同页面标签（输出 33）。
- **类型放宽**：`FileEditorKind` 改为 `string`。`commands.ts`、`session-record.ts` 的字面量联合改为字符串；`EditorGroup.vue` 的 `kinds` 改为按组里出现的编辑器 id 求出，不再写死两种。每组每种编辑器一个控件、视图状态每组每种最多 3 份的规则不变。

### 2. 字节读取（`plugins/files/backend/raw-route.ts`、`files/web/client.ts`）

- **路由**：`nbook.files` 的 server 入口贡献 `http.routes`，提供 `GET /api/nbook.files/raw/project/<项目 id>/<路径…>` 与 `GET /api/nbook.files/raw/user/<路径…>`。路径式地址是为了让 HTML 里的相对引用直接落到同一棵树上。
- **找文件**：项目根经宿主能力 `projectsKey` 按 id 找登记的目录，与封面路由（`projects/backend/cover-routes.ts`）同一个来源。路径包含与符号链接规则复用 `files/backend/rooted.ts`，不另写一套。
- **响应**：
  - 按扩展名的白名单给 `Content-Type`，其它一律 `application/octet-stream`；
  - `X-Content-Type-Options: nosniff`；
  - `Content-Security-Policy: sandbox`：有人直接打开一个 HTML 或 SVG 的地址，也不会在应用的源里运行；
  - `ETag` 取修改时间加大小，`Cache-Control: no-cache`；
  - 失败给 JSON `{code, detail}`，码沿用文件服务的 `not-found`、`permission-denied`。
- **浏览器端**：文件客户端加 `rawUrl(address)`，按窗口绑定的项目拼出地址；没有绑定项目、或地址不是 `project://`、`user://` 时返回 null。
- **字节绑定**：`input: "bytes"` 的控件拿到 `{address, url, version}`。编辑器区订阅该文件的变更事件：改了就把 `version` 加一，控件据此重新取；删除、改名沿用标签已有的处理（输出 17、18），只是没有正文要保留。这类标签不 dirty，没有字数，也没有光标。

### 3. HTTP 写请求核对来源（`plugins/http/backend/dispatch.ts`）

- 预览里的脚本跑在不透明的源里，RPC 的 WebSocket 会因 `Origin: null` 拒绝它（`server-host.md` 场景 12）。
- 但 HTTP 端口现在不核对来源，`POST` 一类“简单请求”能从沙箱里发出来。补一条：分发前，`GET`、`HEAD` 以外的请求如果带了 `Origin`，且它不在允许的来源里（含 `null`），返回 403。允许的来源与 RPC 用同一个 `allowOrigin`。不带 `Origin` 的本机进程照旧放行，这是鉴权上线前已写明的限制。

### 4. 同一文件可以开两个标签（`editor/web/groups/groups.ts`、`area.ts`）

- 标签的身份从“地址”改为“地址 + 编辑器”。这样 `a.html` 的源码和它的预览可以在同一组里并存。
- `open` 不指定编辑器时：本组有这个地址的非预览标签就激活它，不管它是哪种编辑器（例如 Markdown 已换成源码打开）；没有就按第 1 节的顺序选编辑器、新开。
- `open` 指定编辑器时，按“地址 + 编辑器”匹配。
- `reopen-with` 要换成的编辑器在本组已有同一地址的标签时，切过去并关掉当前这个。
- `rebind`、`closeWithin` 照旧按地址处理，同一地址的标签一起跟着改名或关闭。

### 5. 预览（`editor/web/title-actions.ts`、`commands.ts`）

- 命令 `nbook.editor.open-preview {side?: boolean}`：对活动标签的文件，找 `preview: true` 且 selector 命中的编辑器，以 permanent 打开。`side` 为假时在当前组，为真时 `group: "side"`。没有预览编辑器时为 `unavailable`；`when` 读一个新公开键 `nbook.editor/hasPreview`。
- 标题动作：编辑器自己那一节加“打开预览”按钮（`when: hasPreview`），“⋯”里加“在侧边打开预览”。预览标签上不出现这两项。
- 预览标签的标题写“预览 a.html”。它绑定同一份文本文档、只读，所以未保存的修改也会显示；预览标签照常进会话记录。

### 6. 两个内置编辑器插件（`plugins/image-viewer/`、`plugins/html-preview/`）

- 各自只有浏览器入口，各向 `editor.editors` 贡献一个编辑器，用来证明第三方插件将来也能走这个贡献点。两个都登记进产品清单与 Lab。
- **图片查看器** `nbook.image-viewer`：
  - 声明：`priority: "default"`，`input: "bytes"`，扩展名 png、jpg、jpeg、gif、webp、svg。
  - 取图：`fetch(url)` 取 blob 再生成对象 URL，所以能知道字节数，也能把 404 之类的失败原因写出来；SVG 经 `<img>` 显示，里面的脚本不会运行。
  - 显示：默认适应窗口，只缩小不放大；点一下在“适应”和“100%”之间切换，Ctrl + 滚轮缩放；透明的部分用棋盘格底。
  - 状态栏：显示像素尺寸与文件大小。
- **HTML 预览** `nbook.html-preview`：
  - 声明：`priority: "option"`，`preview: true`，`input: "text"`，扩展名 html、htm。
  - 渲染：`<iframe sandbox="allow-scripts" srcdoc>`，不给 `allow-same-origin`。`srcdoc` 里插一个 `<base href>`，指向文件所在目录的字节地址（第 2 节），相对引用的图片、CSS、脚本都从那里取。
  - 更新：正文变化停手 300ms 后整页重载。脚本里的状态会丢，与 VS Code 的 Live Preview 一样。
  - 链接：点页面里的链接只在 iframe 内跳转，不开新窗口（不给 `allow-popups`）。

### 7. 语言贡献点 `editor.languages`（`editor/shared/contracts.ts`、`editor/web/code/`）

- **声明**：贡献 id 就是语言 id，内容是 `{aliases, extensions?, filenames?, firstLine?}`，与 Monaco 的 `registerLanguage` 同一套字段。
- **实现**：`{load(): Promise<{format: "monarch", language, configuration}>}`。`format` 这期只有 `monarch`，Spec 写明 `textmate` 留给第三方插件 Work。
- **内置**：`nbook.editor` 用一张表登记 Monaco 0.55 自带的全部 basic-languages（每项一个动态 `import()`）。
  - 这张表由脚本从 `monaco-editor/esm/vs/basic-languages/*/*.contribution.js` 生成并提交。
  - 一条测试核对它与已装的 Monaco 一致，升级 Monaco 时表过期会直接失败。
  - JSON 仍用 Monaco 自带的语言服务和 worker。
- **选语言**：`MonacoControl` 建模型时按“文件名 → 扩展名 → 首行”选语言，第一次用到时 `load()`，再 `monaco.languages.register`、`setMonarchTokensProvider`、`setLanguageConfiguration`。`load-monaco.ts` 去掉直接引入的语言。
- **状态栏**：加条目 `nbook.editor.language`，源码编辑器活动时显示语言名（例如“TypeScript”“纯文本”）。点它执行 `nbook.editor.change-language`，经 `quickPickKey` 列出全部语言，选中后换当前模型的语言。选择记在标签上（会话记录加可选字段 `language`，旧记录照样合法），刷新后保留。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/editor.md` | `open` 的 `editor` 改为编辑器 id；输出 1 改为按“地址 + 编辑器”找标签；输出 19–20 改写为选择顺序；新增“编辑器贡献”“字节编辑器”“预览”“语言”几节和状态栏的语言条目；“边界与兼容”删掉“只有两种”；补验收场景 |
| `docs/specs/workbench/image-viewer.md`（新） | 图片查看器的行为与验收 |
| `docs/specs/workbench/html-preview.md`（新） | HTML 预览：沙箱、相对引用、更新时机、安全边界、验收 |
| `docs/specs/workspace/files.md` | 新增“按地址读取字节”：路由、白名单、响应头、失败 |
| `docs/specs/runtime/server-host.md` | HTTP 写请求核对 `Origin` |
| `docs/specs/README.md` 注册表 | 两份新 Spec |
| 组件同名 `.md` | `EditorGroup.md`、`EditorArea.md`、`MonacoControl.md`；新组件先写 `.md` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | Spec 与注册表 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 2、3 节 | 字节路由、客户端 `rawUrl`、写请求来源核对 | `bun run test:affected --typecheck` |
| S2 | 第 1 节 | 编辑器贡献点、选择顺序、`markdown`/`code` 改为贡献、重新打开的选择、编辑器不在时的提示 | 同上；`editor-area.e2e.ts` 全部通过（行为不变） |
| S3 | 第 4、5 节 | 地址 + 编辑器的标签身份、预览命令与标题动作、字节绑定 | 同上 |
| S4 | 第 6 节图片 | `nbook.image-viewer`、Lab 场景 | 同上；`lab:shot` |
| S5 | 第 6 节 HTML | `nbook.html-preview`、Lab 场景 | 同上；`lab:shot` |
| S6 | 第 7 节 | 语言贡献点、生成的语言表、状态栏条目与切换语言 | 同上 |
| S7 | — | e2e、Spec 的实现合同与证据、审查与修正 | 下面“验证” |

## 验收映射

| 行为 | 测试 |
|---|---|
| 选择顺序：调用方指定 → default 贡献（文件名优先于扩展名、同级取先登记并诊断）→ `code`；png 没有查看器时显示“不能在这里打开” | `editor/editors.test.ts`（纯函数）；`area.test.ts` 增补“二进制兜底”一例 |
| 重新打开列出命中的全部编辑器；选中后换；编辑器不在时有提示和“用默认编辑器打开” | `area.test.ts`、`title-actions.test.ts` 增补 |
| 同一组里 `a.html` 的源码与预览并存；不指定编辑器的打开激活已有的非预览标签；改名两者一起跟 | `groups.test.ts` 增补 |
| 字节路由：项目与 user 两个根、白名单类型、`nosniff` 与 `sandbox` 头、越界路径与符号链接被拒、文件不在 404 | `files/raw-route.test.ts`（真实临时目录、真实 HTTP 分发） |
| 写请求带不允许的 `Origin`（含 `null`）得到 403；GET 与不带 `Origin` 的照旧 | `http/backend/dispatch.test.ts` 增补 |
| 图片：打开 png 和 svg 显示出来、状态栏有尺寸与大小；外部改写后刷新；删掉后标“已删除” | `e2e/editor-types.e2e.ts` |
| HTML 预览：标题有“打开预览”，点了在当前组开预览标签；“在侧边打开预览”开到右侧；改正文不保存、停手后预览更新；相对引用的图片显示出来；预览里的脚本运行；脚本读不到 `parent.document`、连 RPC 被拒、发 `POST` 到 `/api/` 得到 403 | `e2e/editor-types.e2e.ts` |
| 语言：`.py`、`.go`、`.rs` 等打开后有高亮（取 token 的 class 判）；状态栏显示语言名；切换语言后高亮随之变化，刷新后保留；语言表与已装 Monaco 一致 | `e2e/editor-types.e2e.ts`；`editor/web/code/languages.test.ts` |
| 现有行为不变 | `editor-area.e2e.ts`、`welcome.e2e.ts`、`bookshelf-stats.e2e.ts`、`lab-editor.e2e.ts`，以及编辑器的 Bun 测试 |

## 验证

- 每片：`bun run test:affected --typecheck`；改到 Lab 夹具时对该组件跑 `lab:shot`。
- 收口：生产构建后跑上表的 e2e（本机 Chrome、真实 Files），在 390px 与 1400px 宽下看图片查看器和预览标签；明暗两种主题各看一次。
- 审查：前端（S2–S6 的界面与组件）派 Sonnet `reviewer`；后端（S1 的字节路由与来源核对、第 4 节的标签身份模型）开 omp 会话审查。
- 留下的未验证边界：Windows 与 macOS 上的路径与符号链接规则（与 `workspace/files.md` 已写的限制相同）；超大图片的内存占用不做测量。

## 不做

- TextMate 语法、Vue 等语言插件（第三方插件 Work）；LSP（暂缓）。
- PDF、音视频、字体的查看；图片编辑。
- Markdown 预览：Markdown 本来就是富文本编辑，这期不加。
- 第三方插件使用 `editor.editors` 与 `editor.languages` 的公开说明与例子（第三方插件 Work）。这期的合同写进 Spec，只给内置插件用。

## 风险

- 标签身份从“地址”改成“地址 + 编辑器”，会碰到打开、拆分、改名、会话恢复几条路径。S3 先让现有 `groups.test.ts` 与 `editor-area.e2e.ts` 原样通过，再加新路径。
- `srcdoc` 加 `<base>` 的做法：页面里本来就有 `<base>` 时以页面的为准，相对引用可能落不到文件目录。Spec 写明这一点，不去改写用户的 HTML。
- 字节路由在服务端直接读项目目录，不经过项目子进程；它和项目子进程里的文件服务必须用同一套路径规则，所以只复用 `rooted.ts`，不另写。
