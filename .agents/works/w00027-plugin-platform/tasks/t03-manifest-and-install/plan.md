# 实施计划：清单校验与第三方插件安装（S1）

2026-10-17 起草，同日开发者确认（决定见 [t01 plan](../t01-requirements/plan.md#已确认2026-10-17)）。范围见 [README](README.md)。

## 交付顺序

| 切片 | 内容 | 完成判据 |
|---|---|---|
| S1a | 内核清单解析与映射 | 表驱动测试覆盖清单字段与全部拒绝原因；`descriptorOf`／`definitionOf` 的往返测试 |
| S1b | 登记表与安装算法 | 真实临时目录上的安装、卸载、启用／禁用；原子写与中断恢复；符号链接与路径越界拒绝 |
| S1c | `nbook.plugins` 服务端入口 | 远程合同可经内核调用；启动时发现并登记；安全模式跳过第三方 |
| S1d | 宿主接入与引导协议 | 第三方描述进入服务端集合与引导响应；窗口接收并注入运行期描述 |
| S1e | 设置窗口插件页 | 列表、安装、启停、卸载；真实浏览器 e2e |

## S1a 内核清单

独立机制入口 `@notnotype/nb-runtime/plugin-manifest`（`packages/nb-runtime/src/plugin-manifest/`，用 TypeBox 校验）。不放进 `src/plugins/`：该目录的边界测试只允许同目录相对导入与 `lifecycle`／`services` 公开入口，不能依赖 TypeBox。

- `readPluginManifest(value: unknown): ManifestReadResult`，`ok` 时给出规范化清单；`invalid` 时给出 `{path, message}[]`（按路径稳定排序）。
- 校验：`name`、`publisher`、`version`（semver）、`engines.neurobook`、`entries`、`contributes`、`contributionPoints`、`activationEventPrefixes`、`pluginVersions`；插件 id 为 `<publisher>.<name>`，第三方不得以 `nbook.` 开头；入口 `main` 必须是相对路径、不含 `..`、不以 `/` 开头；`provides` 的服务 id 以本插件 id 加 `/` 开头；`activationEventPrefixes` 不含 `onRemote`；`pluginVersions` 不列内置插件。
- `descriptorOf(manifest)` → `PluginDescriptor`（id、version、`locations` 取入口位置的并集、顶层 `contributions`）。
- `definitionOf(manifest, location)` → `PluginDefinition`（本位置入口的 `id`、`location`、`dependencies`、`provides`、`activationEvents`、`receives`、`contributions`；`activate` 留空占位，代码装载由 t04 提供）。
- 入口 `main` 是否存在、是否真实位于插件目录内，由调用方（安装器）在文件系统上核对；解析器只做字符串与结构校验。
- 清单字段与 npm `package.json` 同名，额外字段集中在 `nbook` 下还是平铺，按 Spec 的表格（当前平铺）。实现前先把 id 与 `publisher`／`name` 的精确规则补进 `plugin-manifest`（S0）。
- 内置插件对齐测试（应用侧）：把 `productPlugins` 的每个描述与各位置定义转成清单格式，经 `readPluginManifest` 校验，再用 `descriptorOf`／`definitionOf` 转回，与原值比对（`activate` 除外）。内置插件不生成清单文件。

不做的：`version-mismatch` 受阻推导。它要求定义携带插件版本，而 `PluginDefinition` 目前没有版本字段；等第三方插件可以依赖彼此（t04 之后）再加。

## S1b 登记表与安装（`src/plugins/plugins/backend/`）

- `paths.ts`：`<State Root>/plugins/` 下的 `plugins.json`、`<id>/<version>/`。
- `registry.ts`：
  - 读：`plugins.json` 不存在时视为空；结构不符合 `nbook.plugins/v1` 时整体不加载并记诊断，不覆盖文件。
  - 写：写临时文件再 `rename`（与 `settings` 的层写入同一模式）；串行队列，同一插件的操作不并发。
  - `list()`：合并登记表与磁盘现状，给出 `installed`、`enabled`、`manifestProblem`、`source`。内置插件也列出（`source: "builtin"`、恒为启用、版本为产品版本）；本轮对内置插件的 `enable`／`disable`／`uninstall` 拒绝 `builtin-fixed`。
  - `install(sourcePath)`：解析路径 → 读 `package.json` → `readPluginManifest` → 拒绝 `nbook.` 前缀 → 检查 `engines.neurobook`（用产品版本，见风险）→ 目标 id 已安装时：同版本拒绝 `already-installed`，不同版本按重启生效的升级处理（复制到新版本目录，登记表记下待切换版本，下次启动切换并删除旧版本目录）→ 复制（有 `files` 按它，否则整目录排除 `node_modules`、`.git`）→ 拒绝符号链接与越界项 → 核对全部 `main` 存在 → 写登记表 `enabled: true` → 返回新条目。
  - `uninstall(id)`：只限第三方；删目录与登记项；不删私有存储与配置（本轮无该选项）。
  - `setEnabled(id, enabled)`：写登记表；本轮的效果在下次启动。
- 源目录位于 `<State Root>/plugins/` 之内时拒绝（自我复制）。

## S1c `nbook.plugins` 插件

- `plugin.ts`：`id: "nbook.plugins"`，`locations: ["server", "browser"]`，顶层贡献：设置分区 `nbook.plugins.installed`（`category: "plugins"`、`kind: "page"`、`layers: ["user"]`）。
- `shared/contracts.ts`：远程合同 `nbook.plugins/registry`，provider `server`，methods：
  - `list {} → {plugins: PluginListItem[]}`（只读）
  - `install {path: string} → {plugin: PluginListItem}`
  - `enable {id} → {plugin}`
  - `disable {id} → {plugin}`
  - `uninstall {id} → {removed: true}`
  - 失败码沿用内核的 `{ok, code, detail}` 与远程合同的业务失败码约定；路径与清单问题都转成可读的 `code`，不把 Node 错误原文发给窗口。
- `backend/plugin.ts`：依赖 `stateRootKey`、`diagnosticsKey`；提供远程服务；启动时扫描已安装且启用的插件，把**有效的**描述交给宿主。
- 宿主接入：`ServerPluginContext` 增加第三方描述与定义（或新增 `src/server/third-party.ts`），`manifestServerPlugins` 对第三方只用 `definitionOf(manifest, "server")`（S1 中第三方没有入口，`entries: []`）。

## S1d 引导协议与窗口

- `shared/browser-bootstrap.ts`：`BROWSER_PROTOCOL_VERSION` 升到 3；`plugins` 条目增加 `locations` 与 `contributions`（第三方需要它们登记顶层贡献）。内置插件仍以构建内的定义为准，引导里的描述只用于第三方与版本核对。
- `web/host/window.ts`：`selectPlugins` 对不在 `builtin` 里的引导插件，用引导带来的描述合成 `builtin` 条目；`locations` 不含 `browser` 且没有定义时按 `definitionAt` 生成空入口定义。
- 内置插件的核对不变：id 与版本必须与构建一致，不一致提示刷新。
- 安全模式：第三方不进入引导集合。

## S1e 设置页

- `web/plugin.ts`：浏览器入口贡献 page 分区，`load()` 返回 `PluginsPage.vue`；页面经 `context` 属性拿到当前层（插件页固定用户层）与窗口连接，调用远程合同。
- 页面内容：列表（名称、id、版本、来源、状态、启用开关、卸载；内置插件标“内置”，没有开关与卸载）、安装（路径输入 + 确认，确认文案写明完全信任）、顶部提示“启用／禁用与安装在下一次启动后生效”。
- 复用 `nb-ui` 的 `SettingsRow`、`Switch`、`Button`、`Dialog` 与通知；不新建样式体系。

## 内置插件版本与信任

- 内置插件描述的 `version` 改为引用 `PRODUCT_VERSION`（`src/shared/product.ts`），不再各写各的；窗口按 id 与版本核对构建的规则不变。
- 信任所有插件（ADR 0027）：删除代理允许清单——内核 `PluginHostOptions.delegation` 与 `ApplicationManifest.delegation`、`src/manifest.ts` 的 `delegatingPlugins`、三个宿主的接线与测试里的配置；`delegation.test.ts` 与示例场景 05 中“不在允许清单被拒”的用例删除。身份签发核对（`issuedTo`）与合同须在 `remoteDelegates` 里的核对保留。代码落地后：去掉 `runtime/services.md` 输出 13、`runtime/plugins.md` 输出 20、`runtime/plugin-channel.md` 输出 10 的“（planned）”，并改写三处实现合同（`runtime/application.md` 的 `ApplicationManifest`、`runtime/plugins.md` 的经代理远程调用、`settings/configuration.md` 的 owner 与依赖方向）里的允许清单。宿主适配器 `nbook.diagnostics`、`nbook.http` 仍按 ADR 0026 只能内置。

## 验收映射

| Spec 条目 | 验证 |
|---|---|
| `plugin-manifest` 输入表、失败与恢复 | S1a 表驱动测试：每个字段的合法／非法各一条，拒绝原因稳定 |
| `plugin-install` 输出 1（列表）、2（安装）、3（卸载）、4（启停）、7（安全模式） | S1b 真实临时目录测试；S1e 组件测试与 e2e |
| `plugin-install` 输出 5（热升级）、6（不兼容） | 本轮不实现升级；不兼容清单在列表里显示 `manifestProblem`，e2e 覆盖一条 |
| `browser-host` 引导集合 | S1d 窗口测试（第三方描述注入、版本不一致仍拒绝）与 e2e |
| `settings-window` page 分区 | S1e 组件测试 + e2e 打开设置看到插件页 |

真实浏览器 e2e：用仓库内的固定样例目录安装 → 重启开发服务 → 设置窗口出现该插件的设置项 → 禁用 → 重启后消失 → 卸载后登记表与目录清空。样例放 `packages/neuro-book/examples/external/declarative/`。

## 风险与未决

- **产品版本**（已定）：应用版本改为 `0.1.0`，`PRODUCT_VERSION` 读它；安装时真检查 `engines.neurobook`，不满足拒绝 `incompatible-engine`。0.x 期间插件 API 有破坏性改动时 minor 加一，这条规则写进 `plugin-install` 与 SDK README。
- **semver 范围匹配**（已定）：用 `Bun.semver.satisfies`，不新增依赖。
- **npm `files` glob**：Bun 的 `Glob` 可用；实施时用真实样例核对 `files` 的目录与通配语义，并写进 Spec 的 S0 收口。
- **启停即时生效**（已定）：本轮下次启动生效，`plugin-hot-plug` 留在 t01 plan 的 S5。
