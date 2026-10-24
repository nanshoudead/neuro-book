# 实施计划：插件平台的分层重设计

架构设计见 [design.md](design.md)，本文只写怎么改、按什么顺序、怎么证明改对了。本计划按 design.md 第 5 节各待决项的推荐写成；开发者改判哪一项，就改对应的切片。

## 1. Context

- **为什么做：** t12 的两份复查发现插件平台的分层没守住：
  - 内核写死 NeuroBook；
  - 第三方插件管理散在应用的 7 个目录；
  - SDK 公开面不由一处决定；
  - 作者材料埋在应用的 `scripts/` 和 `examples/` 里。

  开发者 2026-10-24 用“另一个应用也要插件模式”的假想实验检验耦合，并定了方向（design.md 第 1 节）。
- **期望结果：**
  - 内核与应用无关；
  - 应用里的通用插件管理有自己的目录、档案和机检边界；
  - 公开 API 只有一个入口、子路径名单只有一处；
  - 作者材料在应用包的 `plugin-sdk/` 里；
  - 除 D1 写明的一处破坏（依赖诊断服务的外置插件要重建）外，外部行为不变。作者 API 的改动另成一个 Task（design.md 第 4 节）。
- **依据：**
  - Spec：[plugin-manifest](../../../../../docs/specs/runtime/plugin-manifest.md)、[plugin-install](../../../../../docs/specs/runtime/plugin-install.md)、[plugin-code-loading](../../../../../docs/specs/runtime/plugin-code-loading.md)、[plugin-api](../../../../../docs/specs/runtime/plugin-api.md)、[plugins](../../../../../docs/specs/runtime/plugins.md)、[diagnostics](../../../../../docs/specs/runtime/diagnostics.md)、[browser-host](../../../../../docs/specs/runtime/browser-host.md)；
  - ADR：[0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)、[0027](../../../../../docs/adr/0027-builtin-and-third-party-plugins-are-equal.md)；
  - [包边界](../../../../../docs/modules/monorepo-boundaries.md)。
- **工作方式：**
  - 在 Work 分支 `feat/w00027-plugin-platform` 上逐片提交、逐片验证，每片结束后合入 master；
  - t11 并入 S1b；
  - 待确认清单改判的“typebox 进宿主模块表”在 S3 做；`provide` 改名归作者 API 的 Task。

## 2. 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 公开面闭包的计算 | TypeScript 编译器 API 解析导入；`.vue` 用 `@vue/compiler-sfc` 取脚本块再解析 | 仓库已有这两个依赖；否决正则扫 `import`；不处理 `.vue` 会漏掉设置页组件下面的 5 个文件 |
| 作者文档的设计变量与配色清单 | 配色用 nb-ui 已有的 `./colorway`；设计变量读 nb-ui 新导出的 `./tokens.css`、`./theme.css` | CSS 是真相源；否决正则读 TS 源码（F4），也否决在 TS 里再列一份变量名（会和 CSS 漂移） |
| 打包 tarball | `npm pack`，由打包脚本调用 | 现有作者文档已用它；否决手写 tar |
| 规范化比较合同 | 挪进内核的远程合同模块，复用内核已有的 JSON 编码 | 否决在应用里保留补丁 |

## 3. 关键设计

设计正文在 design.md，这里只列每片要动的位置与要守的不变量。

### `packages/nb-runtime`（S1）

- **平台档案与清单格式（`plugin-manifest/`）：**
  - 新增 `PluginPlatform` 与 `createManifestFormat`；
  - 模块级的 `readPluginManifest`、`manifestOf`、`BUILTIN_PUBLISHER` 删掉，调用方改用格式对象；
  - 文件拆成读与校验、由定义生成、还原定义三份，合同 schema 的遍历只留一份。
- **内核装配（`application/`、`plugins/`）：**
  - `ApplicationManifest.platform` 可选，经 `bootstrap.ts` 传给插件宿主；
  - `idPrefix: "plugin"` 对保留发布者放宽（D2）；
  - 合同对所有入口按“同一对象或规范化内容相同”核对，以登记的那份为准（D3）；
  - 激活产出不是对象时以 `activation-threw` 结束（t11）。
- **诊断插件改名（D1）：** `diagnostics/plugin.ts` 改为 `runtime.diagnostics`，服务键改为 `runtime.diagnostics/diagnostics`。
- **应用的落点（S1a 就建）：** 纯数据档案 `src/plugin-platform-profile.ts`，先只含 `engine`、`reservedPublishers` 与清单格式对象，S2a 再加其余字段。
- **应用的默认装配入口（S1b）：** 默认带 NeuroBook 档案，生产三处宿主与测试夹具都走它；装真实内置插件的 4 个设置测试文件（`settings/window.test.ts`、`web/sections.test.ts`、`commands.test.ts`、`settings.test.ts`）及其夹具改用它；加一条测试：三处生产装配里 `nbook.works` 分区被接受。
- **测试：** 示例 id 由 `nbook.*` 改为 `acme.*`；清单格式测试覆盖 `runtime.*`（`isBuiltinId` 为真）；加两项测试，一是用另一份平台档案跑清单与装配，二是扫描非测试源码不出现 `nbook`、`neurobook`。
- **不变量：**
  - 不给 `platform` 时内核行为与现在相同，只是贡献前缀不放宽；
  - NeuroBook 的清单格式不变，已安装插件的清单照常读得出（D1 那一处除外）。

### `packages/neuro-book/src/plugin-platform/`（S2）

- **目录与平台档案：** 目录结构与档案的两层见 design.md 第 3.4 节；NeuroBook 的档案在 `src/plugin-platform-profile.ts`。
- **从哪里搬来：**
  - `src/backend/plugins/*` 进 `backend/`：版本目录读取进 `backend/version-dir.ts`，升级预览进 `backend/preview.ts`；
  - `src/manifest.ts` 里第三方的部分进 `shared/definitions.ts`；
  - 服务端装载器 `loader.ts` 进 `backend/`；
  - `src/web/host/plugin-code.ts`，以及 `window.ts` 里的第三方登记与样式挂载，进 `web/`；
  - `src/shared/plugin-modules.ts`、`plugin-files.ts`、`plugin-code-error.ts` 进 `shared/protocol.ts` 与同级文件，`src/shared/versions.ts` 进 `shared/versions.ts`；
  - `src/server/plugin-files.ts` 的请求处理进 `backend/`，应用留适配器；
  - `scripts/plugin-sdk/build-plugin.ts` 进 `build/`。
- **`definitionAt`、`pluginsAt`** 随 `registerThirdParty` 搬进 `shared/definitions.ts`，`src/manifest.ts` 保留 `productPlugins` 并再导出这两个名字，13 个调用点不用改。
- **档案的三个文件：** 纯数据、服务端模块表 `src/backend/plugin-host-modules.ts`、浏览器模块表（现有的 `src/web/host/plugin-modules.ts`）；`tsconfig.web.json` 的 include 补上纯数据档案。
- **字面量进档案：** 通用代码里的 NeuroBook 字面量（design.md 第 2.2 节列的那些）全部改从档案读。持久的两项取原值：登记表的模式标记、作者 `package.json` 的字段名。
- **类型反转：** 列表、预览、未装载原因、失败码的模式移到 `shared/types.ts`，`src/plugins/plugins/shared/contracts.ts` 改为引用它们；失败码按方法收窄（D4）。
- **边界机检：**
  - 架构测试按子目录列出允许的导入，`build/` 例外可用 Vite；
  - 扫描非测试源码的标识符与字符串字面量不出现 `nbook`、`neurobook`、`NeuroBook`，不看导入说明符；宿主模块的虚拟命名空间、脚本地址的全局名这类内部名字改成中性名；
  - 每条新规则配一条“能拦下违规”的用例；
  - Tailwind 源码扫描排除 `build/`；
  - 两份 tsconfig 的 include 按 `shared`、`backend`、`web` 分。
- **不变量：** 安装、启停、卸载、升级、版本租约、启动盘点、装载、文件端点的外部行为不变；用户状态根里已有的登记表照常读写。

### `packages/neuro-book/src/sdk/`（S3）

- **入口表：** 新增 `entries.ts`，共享模块表与构建预设的外部名单由它生成；再加一条测试，把两份 tsconfig 与 Vite 的别名和入口表对照。
- **`/components`** 改为具名再导出，三个子路径都有导出名单快照。
- **公开面闭包：** 新增闭包快照测试 `surface.test.ts`；闭包里不再有文件经工作台合同的汇总模块取东西（两个贡献助手与 `src/sdk/index.ts`），命令合同去掉末尾对快捷键与菜单的再导出；目标 30 个文件（第二轮审查实测）。
- **typebox 进宿主模块表：** 共享 `typebox`、`typebox/value`、`typebox/compile`，浏览器与服务端两张表都加，构建预设不再把它打进插件。

### `packages/neuro-book/plugin-sdk/`（S4）

- **迁入：**
  - `scripts/plugin-sdk/` 里除构建预设以外的部分：命令行、`create`、模板、作者文档、打包、测试与测试工具；
  - `examples/` 整个。
- **构建预设的封装：** `plugin-sdk/build.ts` 绑定 NeuroBook 档案，打包成 SDK 的 `./build`；`src/plugin-platform/build/` 只收档案参数。
- **打包：**
  - 产出 tarball 并打印路径；
  - 构建预设与作者命令的产物里不含 SDK 的实现（测试核对）；
  - tarball 带 `examples/` 下的示例插件；
  - 作者文档的清单改用 nb-ui 的导出（nb-ui 的 `package.json` 加 `./tokens.css`、`./theme.css`）。
- **测试设施与脚本：**
  - 应用的 tsconfig、Vitest、bunfig 的路径从 `examples/`、`scripts/plugin-sdk/` 改为 `plugin-sdk/`；
  - `build:sdk`、`build:examples` 两个脚本改为指向新位置，脚本名不变；
  - 架构测试里写死的 `../examples/` 前缀（约 15 处）改为新路径；
  - e2e 里写在字符串里的路径（`bun -e` 调用的脚本等）与按相对层数写的路径（`new URL("../../")`、`../../../../../node_modules/`）逐个改，类型检查看不到它们；
  - 同一提交里改引用旧路径的文档链接：`docs/modules/monorepo-boundaries.md`、`docs/specs/settings/settings-window.md`、根 `AGENTS.md`、`docs/standards/code/common.md`、`packages/nb-runtime/AGENTS.md`，否则这一片过不了 `docs:check`；
  - 测试工具去重（F14、F15）。
- **作者文档：** 修正过时与重复的内容（F16、F17），补上缺的说明（design.md A9 里属于文档的部分可以先做）。
- **不变量：** 产品代码不引用 `plugin-sdk/`；示例只用 SDK 的名字。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `runtime/plugin-manifest.md` | 清单格式由平台档案参数化（引擎键、保留发布者），写明 NeuroBook 的取值；生成即校验 |
| `runtime/plugins.md` | `idPrefix: "plugin"` 对保留发布者的放宽（D2），并去掉已实现条目上过时的“（planned）”；合同按内容核对（D3）；激活产出不是对象时的结果（t11）；`ApplicationManifest.platform` 可选及缺省行为 |
| `runtime/application.md` | 应用清单的 `platform` 字段 |
| `runtime/server-host.md`、`browser-host.md`、`state/public-state.md`、`storage/persistence.md`、`workspace/files.md` | `runtime.diagnostics`（D1），共 8 处 |
| `runtime/plugin-install.md` | 失败码表按方法收窄（D4） |
| `runtime/plugin-code-loading.md` | 宿主模块表加 typebox 三个说明符；共享模块名单的出处；文件端点的挂载前缀 |
| `runtime/plugin-api.md` | “SDK 的组成”改写：公开入口在 `src/sdk/`，作者包的源在 `plugin-sdk/`，打包出 tarball 并带示例；兼容范围加 TypeBox；诊断服务键改名对外置插件的影响 |
| `docs/adr/0027-…` | 决策 1 补一句：保留发布者内的贡献 id 前缀由内核规则放宽 |
| `docs/adr/0029-plugin-platform-layering.md`（新） | 内核与应用无关、平台档案；通用插件管理暂留应用并按目录机检；作者材料留在应用包的 `plugin-sdk/`；记录做法 A、B、C1 与“现在抽包”的否决理由 |
| `docs/modules/monorepo-boundaries.md` | 内核一行写明“与应用无关，应用名由平台档案给出”；应用一行写明 `src/plugin-platform/` 与 `plugin-sdk/` 的定位 |
| `packages/nb-runtime` 的说明、`packages/neuro-book/AGENTS.md`、`scripts/AGENTS.md` | 同上的定位；目录约定加 `src/plugin-platform/`、`plugin-sdk/`，去掉 `scripts/plugin-sdk/` 与 `examples/` |
| 引用 `examples/`、`scripts/plugin-sdk/` 路径的文档：`docs/specs/settings/settings-window.md`、根 `AGENTS.md`、`docs/standards/code/common.md`、`packages/nb-runtime/AGENTS.md` | 路径改到 `plugin-sdk/`，随 S4 同一提交 |

## 5. 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1a | 平台档案、清单格式对象、清单文件拆分；应用各处改用格式对象（id 规则只剩一份）；内核测试改 `acme.*` 并加另一份档案的用例 | 内核与应用调用方同一提交 | 内核 `bun test`；应用 `bun run typecheck`，`bun test src/backend src/server scripts/plugin-sdk` |
| S1b | 内核装配收 `platform`；`idPrefix` 统一（D2），删 8 份前缀计算，另 5 处改用 `isBuiltinId`；合同按内容核对（D3），删应用补丁；激活产出形状（t11）；内核源码的应用名扫描 | 一提交 | 内核 `bun test`；应用 `bun run test`（Bun 与 Vitest），改了文案的校验器测试同步 |
| S1c | 诊断插件改名（D1）；重建示例产物；ADR 0026、0027 与应用 README 里的提法 | 一提交 | `rg "nbook\.diagnostics"` 在现行代码、Spec、ADR、README 里逐个判过；内核与应用测试；`e2e/plugin-code.e2e.ts` |
| S2a | 文件搬进 `src/plugin-platform/`，只搬家；档案两层与字面量进档案；`types.ts` 反转；架构测试与 tsconfig 的 include | 纯搬家单独一提交，档案与反转另一提交 | 应用 `bun run typecheck`、`bun run test`；`e2e/plugin-code.e2e.ts`、`e2e/plugins.e2e.ts`；搬家前后 Bun 与 Vitest 的用例总数相等 |
| S2b | `registerThirdParty` 合并、主线命名、失败码收窄（D4）、F20 各项（含 `..foo` 修正，补用例）、文件端点的处理函数与适配器 | 一提交，Spec 同步 | 同上 |
| S2c | 构建预设搬进 `build/` 及其小修；Vite 例外与 Tailwind 排除 | 一提交 | 同上，外加构建预设的测试；`bun run build:web` 产物里没有 `build/` 的代码 |
| S3 | 入口表与别名对照测试、`/components` 具名、导出名单快照、闭包快照与三处缩小、typebox 进模块表 | 一到两个提交 | 应用全部测试；`plugin-code.e2e.ts`；在仓库外装 SDK 构建一个插件，确认产物里没有 typebox |
| S4 | 建 `plugin-sdk/`，迁入作者材料与示例；构建预设封装；打包产出 tarball 并带示例；nb-ui 的 CSS 导出与文档生成；测试设施路径与去重；路径改动牵连的文档链接；作者文档修正 | 迁移（含文档链接）一提交，去重与作者文档另一提交 | 应用全部测试，用例总数与搬家前相等；`e2e/plugin-authoring.e2e.ts`、`plugin-code.e2e.ts`、`plugins.e2e.ts`；`docs:check` |
| S5 | ADR 0029、ADR 0027 补充、包边界、各包说明、Spec 收尾 | 一提交（master 上） | `docs:check`、`governance:check` |

S1 到 S3 不改目录布局，可以逐片合入 master；S4 改了作者材料的位置，合入前跑全量 e2e。

## 6. 验收映射

除 D1 外不新增外部行为，验收是“外部行为不变”加上新的边界机检。各片的 Spec 条目编号在写 Spec 改动时补进本表。

| Spec 或判据 | 由什么覆盖 |
|---|---|
| plugin-manifest：清单的读、校验、生成，内置与第三方的区分 | 内核清单测试，外加另一份平台档案（`acme`）的用例 |
| plugins：贡献 id 前缀（D2）、合同核对（D3）、激活产出形状（t11）、`platform` 缺省行为 | 内核插件测试；内置贡献点校验器的测试删掉重复分支后仍通过 |
| diagnostics 等：诊断插件 id（D1） | 内核诊断测试；应用装配测试；`plugin-code.e2e.ts` |
| plugin-install：安装、启停、卸载、升级、租约、失败码（D4） | `src/plugin-platform/backend` 的测试（真实临时目录与子进程，原测试随文件搬家） |
| plugin-code-loading：服务端与浏览器装载、共享模块表（含 typebox）、文件端点 | `backend/`、`web/` 的测试与 `plugin-code.e2e.ts` |
| plugin-api：SDK 的组成与作者工具（验收场景 12“仓库外写插件”） | `plugin-authoring.e2e.ts`；仓库外装 tarball 的 smoke |
| 边界：内核不出现应用名 | 内核扫描测试 |
| 边界：`src/plugin-platform/` 不引用 NeuroBook 合同、不含应用名字面量 | 应用架构测试与扫描测试 |
| 边界：子路径名单一处 | 入口表与别名对照测试 |
| 边界：公开面 | 导出名单快照、闭包快照 |
| 边界：产品代码不引用 `plugin-sdk/`，示例只用 SDK | 应用架构测试 |

## 7. 验证

- **每片：** 上表的自跑命令。
- **合入 master 前：**
  - `bun run docs:check`、`bun run governance:check`；
  - 应用的 `bun run test`，内核、nb-ui 的测试；
  - 插件相关的 e2e：`plugin-code`、`plugins`、`plugin-authoring`。
- **Task 收口：** 全量 e2e；在仓库外按作者文档走一遍：装 tarball、`create`、`build`、在开发服务的插件页安装、重启后生效，并截图。
- **明确不验证的：** 不做真实的第二个应用。“另一个应用能用”只由内核里另一份平台档案的测试，加上 `src/plugin-platform/` 的边界机检来证明。

## 8. 不做与风险

- **不做：**
  - 作者 API 的形状改动：design.md 第 4 节，单独的 Task；
  - 抽通用插件管理包、把作者材料搬成独立包；
  - 热插拔；
  - 内置插件合同搬家。
- **风险一：和其它会话撞文件。**
  - S1b、S2 会改 `src/server/start.ts`、`src/project/start.ts`、`src/web/host/window.ts` 和几个内置插件的校验器，这些文件别的 Work 也在改；
  - 缓解：S2a 先纯搬家，尽量不改这些文件的正文；每片结束就合入 master。
- **风险二：搬家后漏跑测试。**
  - 示例、场景、构建预设的测试现在靠应用 tsconfig 与 Vitest 配置的 include 被选中，路径一改就可能静默不跑；
  - 缓解：每次搬家前后对一次 Bun 与 Vitest 的用例总数。
- **风险三：测试耗时。** 现在 SDK 构建在两个测试文件里各跑一次，每次约 2 分钟；S4 改为进程内缓存后应只跑一次。
- **风险四：D1 的破坏性。**
  - 本机已装的、依赖诊断服务的外置插件要重新构建；S1c 同时重建示例产物；
  - 开发服务的状态目录里留着的测试插件（`acme.hello`、`dx.daily-goal`）需要的话卸载重装。

## 9. 设计审查的处理

第一轮（Sonnet，2026-10-24，阻断 1、重要 12、建议 6；报告见 [evidences/design-review-1-sonnet.txt](evidences/design-review-1-sonnet.txt)）：

| 编号 | 结论 | 处理 |
|---|---|---|
| R1 | 成立：治理检查禁止任何包依赖主应用 | 作者材料改放应用包的 `plugin-sdk/`，独立工作区包列为待决 D0（design.md 第 3.7 节） |
| R2 | 成立：跨包打平类型要深入应用源码 | 随 D0 消失：打包仍在应用包内进行 |
| R3 | 成立：档案把模块对象与名字混放，还漏了几项 NeuroBook 常量 | 档案分为纯数据与惰性的模块提供函数；补齐字面量清单；加字面量扫描 |
| R4 | 成立：按职责分子目录会让现有前后端规则失效 | 子目录改为 `shared`、`backend`、`web`、`build`，不设汇总入口；Tailwind 排除 `build/` |
| R5 | 成立：文件端点引用 `nbook.http` 的实现 | 平台只给请求处理函数，应用用适配器挂到 `nbook.http` |
| R6 | 成立：应用的三个测试依赖示例 | 随 D0 消失：示例留在应用包，测试照旧 |
| R7 | 成立：测试入口与测试设施要复制 | 随 D0 消失 |
| R8 | 成立：只改再导出不会缩小闭包，快照会漏掉 `.vue` 下的文件 | 改写为“闭包可见，适度缩小”，只改三处、目标不超过 30 个文件；`.vue` 用 `@vue/compiler-sfc` 解析 |
| R9 | 成立：只导出窄类型挡不住从 `defineEntry` 推出的类型 | 窄化移到作者 API 的 A2，与 `defineEntry` 一起改 |
| R10 | 成立：诊断服务键已写进构建出的清单 | D1 写明破坏性，S1c 重建示例产物，Spec 与风险同步 |
| R11 | 成立（针对独立包） | 随 D0 消失；保留“搬家前后用例总数相等”的对账 |
| R12 | 成立：typebox 的说明符与两端未定 | 定为 `typebox`、`typebox/value`、`typebox/compile`，两端都加，兼容范围写进 Spec |
| R13 | 成立：来源标记多余 | D3 改为对所有入口按内容核对 |
| R14 | 成立：允许导入列漏了 | 边界表按实际依赖写全，写明 `locked-replace` 抽包时的处理 |
| R15 | 成立：D2 的范围与 ADR 0027 | 只替换 8 处前缀计算，其余 5 处改用 `isBuiltinId`，命令域规则不动；ADR 0027 补一句 |
| R16 | 成立：设计变量的真相源是 CSS | 配色用现有 `./colorway`，设计变量读 nb-ui 新导出的 CSS 文件 |
| R17 | 成立：和 VS Code 的对照只对一半 | 改写对照，写明我们的 SDK 带实现拷贝 |
| R18 | 成立：五组发现没有着落 | F20 各项进 S2b（`..foo` 是真实错误）；DX F10、F11、F19、F20 进作者 API 的 A2、A7、A9；F17 定为补文档不收名字；DX F18 记为 nb-ui 后续 |
| R19 | 成立 | `platform` 可选并写明缺省行为；扫描范围是非测试源码含注释，内核测试的示例 id 改为 `acme.*` |

第二轮（Sonnet，2026-10-24，阻断 0、重要 5、建议 6；报告见 [evidences/design-review-2-sonnet.txt](evidences/design-review-2-sonnet.txt)）：全部成立，已改。

| 编号 | 处理 |
|---|---|
| N1 | 档案分三个文件：纯数据、服务端模块表、浏览器模块表；加“构建预设与作者命令的产物不含 SDK 实现”的测试 |
| N2 | 应用给默认带 NeuroBook 档案的装配入口，生产三处与测试夹具都走它；4 个设置测试文件改用它；加 `nbook.works` 分区被接受的测试；删掉“47 个调用不用改”的说法 |
| N3 | `plugin-sdk/` 的允许导入补上纯数据档案与 `src/plugin-platform/` 的 `shared`、`build`；测试另列 |
| N4 | `build/` 只收档案参数；绑定档案的封装放 `plugin-sdk/build.ts`，打包成 `./build` |
| N5 | 牵连的文档链接、字符串里的路径、按层数写的相对路径都并入 S4 的同一提交；S4 加跑 `plugin-code`、`plugins` 两个 e2e |
| N6 | 闭包缩小的做法写全（含 `src/sdk/index.ts`），目标 30 |
| N7 | `definitionAt`、`pluginsAt` 随 `registerThirdParty` 搬进 `shared/definitions.ts`，`src/manifest.ts` 再导出 |
| N8 | 扫描只看标识符与字符串字面量，不看导入说明符；内部名字改中性名或进档案 |
| N9 | S1a 就建纯数据档案，S2a 再加字段 |
| N10 | S1c 的检查范围含 ADR 与 README；写明 `isBuiltinId` 含 `runtime`，并有用例 |
| N11 | 架构测试的具体改动列进 S2、S4；新规则各配一条能拦下违规的用例 |
