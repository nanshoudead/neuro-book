# 实施计划：设置补齐（t02）

2026-10-20 起草，待开发者确认。依赖排在它之前的低代码 Task（待建，见“前置：低代码”）。

## Context

配置核心与设置窗口已实现（`settings/configuration.md`、`settings/settings-window.md` 均 `implemented`），但插件开始用配置以后暴露了几类缺口：数组、对象、多行文本只能只读；没有密钥；一组字段一起保存的页面没有保护；下拉选项只能写死；声明要接三处线、list 分区要交空实现；page 分区的插件只能启动即激活；配置一多找不到；不能直接看、改设置文件。旧应用的 provider 设置要在新设置里重建，正好需要其中好几样（见 [说明页](artifacts/settings-sections/index.html)）。

依据：
- Spec：[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)（输出 1、11、19、20 与“声明”“接口”两节）、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（输出 1–9、14、18）、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 输出 21（拥有者定义的激活事件）、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（密钥、`secret-unreadable`）。
- 开发者 2026-10-20 的决定：t02 提前到 t04 之前、不并行，在 Work 分支 `feat/w00027-plugin-platform` 上做；密钥本轮就做，方案 A（加密存状态根，主密钥放系统密钥库，没有时退回状态根下只有本人可读的密钥文件）；排版设置只做 Monaco，Markdown 正文留给 w00025；外观收口另在 t06；“低代码”做宽、整个项目共用一套，排在 t02 之前先实现。

## 前置：低代码

t02 不自己写控件。设置的 list 分区、`SettingsRow` 里的控件，改由低代码 Task 提供的表单渲染器按 schema 画。t02 假定低代码提供（具体接口以那个 Task 的计划为准，定下来后回改本计划）：

- 按 JSON Schema（TypeBox）加界面提示画一个值的编辑控件：布尔、字面量联合（分段或下拉）、数字、单行与多行字符串、字符串数组、对象数组、对象、兜底的 JSON 编辑；
- 选项由调用方在运行时给出（动态选项）；
- 草稿与校验：控件给出“当前草稿是否合 schema”与错误位置；
- 控件类型可以由使用方登记扩展（密钥控件由 t02 登记）。

本计划里凡写“低代码渲染”的地方都指它。

## 关键设计

### 声明 API：`src/shared/settings.ts`

- `defineSettings(plugin, {name: options, …})`：一次声明一个插件的多条配置项，插件 id 只写一次；返回 `{<name>: SettingDefinition, contributions}`，描述里写 `contributions: [...settings.contributions]`。`defineSetting` 保留，供只有一两项的插件用。
- 声明字段新增（界面提示随低代码定名，这里只列 t02 要的）：
  - `secret: true`：见“密钥”；
  - `choices: {from: "<选项提供者 id>"}`：选项来自运行时，见“动态选项”；
  - `ui`：交给低代码的界面提示（例如 `{multiline: true}`、对象数组的标题字段），登记时只核对它是 JSON 对象，内容由低代码校验。
- 登记期校验沿用输出 1、21 的做法：不合规则只拒绝这一条。

### 分区：`settings.sections` 拆成两个贡献点

现在 list 分区要在浏览器入口里贡献，激活后还要交一个空对象，只因为贡献点要求实现。改为：

- `settings.sections`：只放 list 分区，**顶层声明式贡献**（写在描述的 `contributions` 里，`implementation: "none"`），所有实例都知道，不需要入口、不需要激活。
- `settings.pages`：page 分区，仍是浏览器入口的贡献，实现是 `{load()}`。
- 左栏把两者合在一起排；`category`、`order`、`layers`、`layout` 等字段不变，只是分到两处。
- 改动的插件：外观（`nbook.settings`）、编辑器、资源管理器的 list 分区搬到描述；作品、插件、示例 snippets 改用 `settings.pages`。

### 页面拿到配置服务：`src/plugins/settings/web/contracts.ts`

新增 `settingsPage(settings, () => import("./Page.vue"))`：返回 page 实现，`load()` 交出的组件除 `context` 外还收到 `settings`（本插件自己的配置服务）。示例里手写的 `withSettings` 包装删掉。

`SettingsPageContext` 加 `dirty(value: boolean)`，见“未保存保护”。

### 按需激活：`src/plugins/settings/web/`

`nbook.settings` 的浏览器入口登记激活事件前缀 `onSettingsPage`（`runtime/plugins.md` 输出 21）。设置窗口第一次显示一个还处于 `declared` 的 page 分区时触发 `onSettingsPage:<分区 id>`，入口声明这个事件就不必 `onStartup`。触发结果为失败、受阻时按现有的 `entry-failed`、`entry-blocked` 原位呈现（输出 4）。示例 snippets 与 Lab 的“模型服务”改用它。

### 密钥

**存储**（服务端，`src/plugins/settings/backend/secrets/`，新）：
- 文件 `<状态根>/secrets.json`：`{schema: "nbook.secrets/v1", keyStore: "keyring" | "file", keyId, entries: {<键>: {iv, data, tag}}}`，值用 AES-256-GCM 加密（`node:crypto`）；写入同设置文件（临时文件改名、写入锁）。
- 主密钥 32 字节，随机生成：
  - 首次写密钥时，系统密钥库在约 3 秒内可用就存进去（服务名 `NeuroBook`、账号为状态根真实路径的摘要），`keyStore: "keyring"`；
  - 不可用就写 `<状态根>/secrets.key`（权限 0600），`keyStore: "file"`，记一条警告诊断。
  - 之后只用记下的那一处。密钥库暂时不可用（锁着、等用户解锁超时）时读取为 `secret-unreadable`，**不另生成新主密钥**，否则旧密文全部作废。
  - `keyId` 是主密钥的摘要：拿到的主密钥对不上时为 `secret-unreadable`。
- 技术选型：系统密钥库用 `@napi-rs/keyring`（基于 Rust `keyring-rs`，有预编译包，Linux 走 Secret Service、macOS 走钥匙串、Windows 走凭据管理器）。开工第一步实测它在 Bun 下能加载、能在本机的 KWallet（`org.kde.secretservicecompat`）上读写，以及密钥库要求解锁时的表现；不能用时改用 `secret-tool` 命令行（只覆盖 Linux），在计划里改写这一条。
- 迁移与备份：`keyStore: "file"` 时状态根整个拷走就能读；`keyring` 时拷到别的机器读为 `secret-unreadable`，用户重新输入覆盖（plugin-api 的“失败与恢复”）。写进 configuration 输出 20。

**声明与接口**：
- `secret: true` 的项只允许用户层、schema 必须是字符串、不写 `default`（没设置就是没有值），否则 `invalid-declaration`。
- 不进 `settings.json`，`get`、`inspect` 不给值。
- `SettingsService` 加：
  - `secretStatus(setting)`：同步、响应式，`"set" | "unset" | "unreadable"`，所有实例都有；
  - `readSecret(setting): Promise<{ok: true, value: string} | {ok: false, code: "unset" | "secret-unreadable" | "unavailable"}>`：只在服务端与项目实例可用（项目实例经远程到服务端的拥有者），浏览器里调用返回 `denied`；
  - 写入沿用 `update(setting, value | undefined)`，浏览器也能写：值只朝服务端走一次，任何响应、快照、诊断里都没有值。
- 远程合同 `nbook.settings/user` 升到版本 2：层快照加 `secrets: {<键>: "set" | "unreadable"}`；方法加 `readSecret`（`callers` 只有 `project` 与服务端本地）、用户编辑加 `editSecret`、`unsetSecret`（同输出 19 的调用方核对）。
- 设置窗口与 `SettingsRow`：密钥项的控件由 t02 登记进低代码：显示“已设置”或“未设置”、可以输入新值替换、可以清除；`unreadable` 时提示“无法解密，请重新输入”。

### 动态选项

浏览器入口可以贡献选项提供者（贡献点 `settings.choices`，实现是 `{choices(): Readonly<Ref<ReadonlyArray<{value, title}>>>}`）。声明写 `choices: {from: "<提供者 id>"}` 的项，设置窗口经低代码画成下拉，选项来自提供者；当前值不在选项里时照常显示并标“已不存在”。提供者不在（插件没装、没激活）时控件停用并说明原因。值的校验仍只看 schema。

### 未保存保护

page 页面经 `context.dirty(true)` 告诉窗口有未保存的改动。窗口在关闭、切分区、切标签之前弹确认“放弃未保存的改动？”，放弃后照常离开（页面卸载，草稿丢弃），取消则留在原处。页面保存成功后调 `context.dirty(false)`。list 分区每项即时写入，不涉及。

### 搜索

窗口左栏上方一个搜索框。匹配 list 分区里配置项的标题、说明、键与选项名，以及 page 分区声明里新增的可选 `keywords`。有输入时右边换成结果列表（按分区分组，每条是一个 `SettingsRow`，可以直接改）；page 分区的结果只给“打开这个分区”。清空搜索回到原分区。

### 设置文件视图

page 分区之外，窗口给每一层一个“设置文件（JSON）”视图（左栏“其它”下面一项，或标签旁的按钮，样子在 t06 定）：经拥有者的远程方法 `readText`、`writeText`（带修订号，修订号不对返回冲突）读写这一层文件的全文，用低代码的代码编辑控件编辑。用户层的文件在状态根下、浏览器拿不到路径，也走这条路，不用打开文件。写入照常经拥有者校验（解析失败、重复键时拒绝并给出位置）。

### Monaco 排版设置：`src/plugins/editor/`

编辑器插件用 `defineSettings` 声明（编辑器分区，新小组“代码编辑器”）：`code.fontFamily`（字符串，空为跟随主题）、`code.fontSize`（整数 8–40，缺省 14）、`code.lineHeight`（数，0 为自动）、`code.tabSize`（整数 1–8，缺省 4）、`code.lineNumbers`（开、关、相对）、`code.minimap`（布尔，缺省关）、`code.wordWrap`（布尔，缺省开）。`MonacoControl.vue` 创建编辑器时读这些值，变化时 `editor.updateOptions`，不重建编辑器。

### 资源管理器“显示清单文件”

`explorer.preferences` 里的 `showManifests` 改为配置项 `nbook.explorer/showManifests`（只允许用户层），旧记录里的值在第一次读到时迁过去一次。

### Lab 的“模型服务”示例：`src/plugins/lab/web/fixtures/settings-scene/`

补成验证这些能力的样子：服务商列表存成一个对象数组配置项；API Key 是密钥项；“默认模型”是动态选项（来自已配置的服务商）；详情表单用草稿加“保存”，用 `context.dirty`；入口用 `onSettingsPage` 激活。外观不在本轮定。

## Spec 与文档改动

- `settings/configuration.md`：声明字段（`secret` 规则、`choices.from`、`ui`）；`defineSettings`；输出 20 密钥从 planned 写成完整合同（存储、主密钥、`keyStore`、迁移、接口、远程合同 v2）；接口一节加 `secretStatus`、`readSecret`；失败码加 `secret-unreadable`；拥有者的 `readText`、`writeText`。
- `settings/settings-window.md`：分区拆成 `settings.sections`（list，顶层）与 `settings.pages`（page，入口）；输出 4、5 加按需激活；输出 9 的控件改为“由低代码按 schema 与 `ui` 画”，去掉两条 planned；新增搜索、设置文件视图、未保存保护、动态选项、密钥项的输出条目；“不承诺”删去已做的搜索、密钥界面、打开设置文件。
- `runtime/plugin-api.md`：密钥的读取改写成 `readSecret`。
- 组件文档：`SettingsRow.md`、`SettingsControl.md`（或被低代码取代后删除）、`SettingsWindow.md`、`SettingsListSection.md`。
- `examples/README.md` 与示例 snippets 的讲解：`defineSettings`、`settingsPage`、`onSettingsPage`。

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S0 | 改两份 Spec 与 plugin-api | Spec 改动 | `docs:check` |
| S1 | 声明 API 与分区拆分、`settingsPage`、按需激活 | 声明 API；分区；页面拿到服务；按需激活 | 设置的合同测试、`sections.test.ts`、示例场景测试 |
| S2 | 密钥存储与接口（先实测密钥库） | 密钥 | 真实文件系统与真实进程的测试；密钥库的实测记进证据 |
| S3 | 设置控件改用低代码，密钥控件、动态选项 | 前置；密钥；动态选项 | Vitest、Lab 截图 |
| S4 | 未保存保护、搜索 | 未保存保护；搜索 | Vitest、Lab |
| S5 | 设置文件视图 | 设置文件视图 | 拥有者测试、Vitest |
| S6 | Monaco 排版设置、显示清单文件 | Monaco；资源管理器 | 编辑器与资源管理器测试 |
| S7 | Lab“模型服务”示例、e2e | Lab 示例 | `settings.e2e.ts` 扩充 |

每片一个提交，在 Work 分支上；S3 与 S7 之后各一轮实现审查（后端交 omp，界面交 Sonnet）。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| configuration 输出 1、21（新字段的登记期校验） | `src/shared/settings.test.ts` 表驱动 |
| configuration 输出 20（密钥） | 密钥存储测试（加密、`keyStore` 记下后不换、主密钥对不上、文件权限、密文不进快照与诊断）；浏览器读不到值的合同测试；密钥库实测记进证据 |
| configuration `readText`、`writeText` | 拥有者测试（修订号冲突、校验失败不落盘、保留原文） |
| settings-window 分区拆分与左栏 | `sections.test.ts`、`SettingsWindow.dom.test.ts` |
| settings-window 按需激活 | 经真实内核的测试：显示分区前入口未激活，显示后激活并加载 |
| settings-window 搜索、未保存保护、动态选项、密钥项、设置文件视图 | 各自的组件测试；Lab 场景 |
| Monaco 排版设置 | 编辑器测试：改配置后 `updateOptions` 生效、编辑器不重建 |
| 组合场景 | `e2e/settings.e2e.ts`：写密钥后刷新只见“已设置”、页面草稿离开时确认、搜索到一项并改掉、设置文件视图改一个键后窗口同步 |

## 验证

- 每片自跑上表；全部完成后跑应用 `bun test`、Vitest、typecheck、`docs:check`、`governance:check`，以及 settings、plugins、browser-host 三组 e2e（直接跑 Playwright 前先 `build`、`build:e2e`）。
- 真实环境：本机 KDE 的 Secret Service 上写一个密钥、重启服务端后读回；停掉密钥库或拒绝解锁时读取为 `secret-unreadable`、不生成新主密钥。
- 截图看 Lab 里的设置窗口各场景（list、搜索、密钥、动态选项、设置文件视图、“模型服务”）。
- 留下的未验证边界：macOS、Windows 的密钥库；密钥库要求交互解锁时的界面提示只看诊断，不做专门界面。

## 不做与风险

- 不做：本机层（输出 22）；按层过滤；条件显示与自定义单项控件以外的低代码能力（归低代码 Task）；设置界面的外观（t06）；Markdown 正文排版（w00025）；真正的 provider 插件（随 Agent 与模型插件重建）。
- 风险：
  - 低代码的接口还没定，S3 以后的切片会随它调整；
  - KWallet 等密钥库可能在后台服务里弹解锁框或一直挂起，靠超时与诊断兜住，`keyStore` 一经记下不再切换；
  - 远程合同 `nbook.settings/user` 升版本，浏览器与服务端同一构建，影响只在开发中途刷新时；
  - `settings.sections` 拆分改动了已实现的贡献点，内置三处与示例要一起改，第三方还没有使用者。
