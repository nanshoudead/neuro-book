# 实施计划：清单校验与第三方插件安装（S1）

2026-10-17 起草，同日开发者确认（决定见 [t01 plan](../t01-requirements/plan.md#已确认2026-10-17)）；同日按 omp 设计审查（[evidences/design-review.txt](evidences/design-review.txt)，13 条）修订，修订待开发者确认。范围见 [README](README.md)。

## 交付顺序

| 切片 | 内容 | 完成判据 |
|---|---|---|
| S1a | 内核清单解析与映射；内置插件对齐测试 | 表驱动测试覆盖清单字段与全部拒绝原因；每个内置插件的代码定义转成清单格式后通过校验，转回后除运行期钩子外相等 |
| S1b | 登记表与安装算法 | 真实临时目录上的安装、升级、卸载、启停与待生效变化；两个服务端进程同时安装都保留；复制抛错回滚、中断后按提交点恢复；路径中间段的符号链接被拒 |
| S1c | `nbook.plugins` 插件 | 远程合同经内核调用；失败码与 Spec 一致；安全模式跳过第三方 |
| S1d | 宿主接入：服务端、项目子进程、浏览器引导 | 第三方描述进入服务端集合、项目子进程与引导响应；`nbook.*` 缺失仍提示刷新 |
| S1e | 设置窗口插件页 | 列表、安装、启停、卸载、待生效变化与“重启后生效”提示；真实浏览器 e2e |

## S1a 内核清单

独立机制入口 `@notnotype/nb-runtime/plugin-manifest`（`packages/nb-runtime/src/plugin-manifest/`，用 TypeBox 校验）。不放进 `src/plugins/`：该目录的边界测试只允许同目录相对导入与 `lifecycle`／`services` 公开入口，不能依赖 TypeBox。

- `readPluginManifest(value: unknown): ManifestReadResult`，`ok` 时给出规范化清单；`invalid` 时给出 `{path, message}[]`（按路径稳定排序）。
- 校验按 `plugin-manifest` 的输入表与“清单无效”条件：`publisher`、`name` 各为一段 id；第三方不得以 `nbook.` 开头；入口 `main` 必须是相对路径、不含 `..`；`provides`、`remoteProvides` 以本插件 id 加 `/` 开头；`activationEventPrefixes` 不含 `onRemote`；`pluginVersions` 不列内置插件；入口字段含 `optional`（可选依赖）与 `receives`。
- `descriptorOf(manifest)` → `PluginDescriptor`（id、version、`locations` 取入口位置的并集、顶层 `contributions`）。
- `definitionOf(manifest, location)` → `PluginDefinition`（本位置入口的 `id`、`location`、必需与可选依赖、`provides`、`activationEvents`、`receives`、`contributions`；`activate` 留空占位，代码装载由 t04 提供）。S1 的第三方插件没有入口，`remoteProvides`、`remoteDelegates` 的合同 id 到合同对象的映射留到 t04（见 t04 plan 的开工前决定）。
- 入口 `main` 是否存在、是否真实位于插件目录内，由安装器在文件系统上核对。
- **内置插件对齐测试**（应用侧）：把 `productPlugins` 的每个描述与各位置定义转成清单格式，经 `readPluginManifest` 校验，再用 `descriptorOf`／`definitionOf` 转回比对。只排除明确列出的运行期钩子：入口的 `activate`、贡献点的校验函数；服务键按 id、合同对象按合同 id 比对；可选依赖必须仍是可选。宿主能力（`capabilities`）与宿主适配器（diagnostics、http）不在对齐范围。

不做的：`version-mismatch` 受阻推导。它要求定义携带插件版本，而 `PluginDefinition` 目前没有版本字段；第三方插件之间能互相依赖要等 t04 的代码装载，届时在 t04 里做。

## S1b 登记表与安装（`src/backend/plugins/`）

- 布局：`<State Root>/plugins/plugins.json` 与 `<id>/<version>/`；准备中的复制放 `<State Root>/plugins/.staging/<随机名>/`。
- **读改写走 `nbook/backend/locked-replace` 的 `replaceLocked`**（与 `settings.json` 同一把跨进程写入锁、同一套“改名前核对身份、变了就重做”）。同一状态根可以有多个服务端进程（`runtime/projects.md` 不加目录锁），进程内串行挡不住它们互相覆盖。
- 读：文件不存在视为空；结构不符合 `nbook.plugins/v1` 时整体不加载并记诊断，不覆盖文件。记录字段：`version`、`pendingVersion`（可空）、`state`（`enabled`／`disabled`／`uninstalling`）、`deleteData`（卸载时）。
- **提交与回收**：每个操作先在 `.staging` 里准备，持锁把准备好的目录改名到 `<id>/<version>/` 并在同一次加锁替换里提交登记表；提交前任何异常（复制、改名、登记表写入）都删除准备目录与已改名的版本目录；临时文件在 finally 收口。启动时持同一把锁：先按登记表处理卸载中与待切换版本，再回收没有被 `version` 或 `pendingVersion` 引用的版本目录与 `.staging` 残留；删除失败记诊断、下次启动重试。
- `list()`：内置插件（`source: "builtin"`、恒为启用、版本为产品版本）加登记表与磁盘现状；每条带用户状态、待生效变化（与本次启动时的状态比较得出）、`manifestProblem`。
- `install(sourcePath)`：解析与规范化路径（安装根也 `realpath`）→ 源在 `<State Root>/plugins/` 之内拒绝 → 读 `package.json` → `readPluginManifest` → `nbook.` 前缀拒绝 → `Bun.semver.satisfies(PRODUCT_VERSION, engines.neurobook)` → 卸载中拒绝 `uninstall-pending` → 与 `version` 或 `pendingVersion` 相同拒绝 `already-installed` → 复制到 `.staging` → 核对全部 `main` → 提交：未安装时写 `version` 与 `enabled`；已安装时写 `pendingVersion`（替换原待切换版本时，提交之后才删除原待切换版本目录）。
- 复制范围：有 `files` 时按 npm 规则，每项是相对插件目录的 glob，命中目录时递归包含（`Bun.Glob` 只匹配文件，目录项要自己展开）；总是包含 `package.json`；没有 `files` 时整目录，排除 `node_modules`、`.git`。复制范围内每个路径**逐段** `lstat`，任一祖先或末级是符号链接即拒绝 `path-rejected`；复制时核对最终目标仍在源根内。
- `uninstall(id)`：只限第三方；登记表改为 `uninstalling`（本轮不提供删除私有数据的选项，`deleteData: false`），本次运行不删任何文件；下次启动时删除安装目录，最后移除记录。
- `setEnabled(id, enabled)`：写登记表，下次启动生效；内置插件拒绝 `builtin-fixed`。
- **启动时切换版本**：有 `pendingVersion` 时先改登记表指向它（提交点），再按新版本登记，旧版本目录随后作为无引用目录回收。

## S1c `nbook.plugins` 插件

- `plugin.ts`：`id: "nbook.plugins"`，`locations: ["server", "browser"]`。设置分区 `nbook.plugins.installed`（`category: "plugins"`、`kind: "page"`、`layers: ["user"]`）写在**浏览器入口**的贡献里：page 分区需要实现，`settings.sections` 拒绝写在顶层（`settings/settings-window.md`）。
- `shared/contracts.ts`：远程合同 `nbook.plugins/registry`，provider `server`：`list`、`install {path}`、`enable {id}`、`disable {id}`、`uninstall {id}`；业务失败码照 `plugin-install` 的失败码表，不把 Node 错误原文发给窗口。
- `backend/plugin.ts`：依赖 `stateRootKey`、`diagnosticsKey`；提供远程服务。启动时的发现与切换在宿主装配插件之前完成（插件集合在进程生命期内不变），由宿主调用 `src/backend/plugins/` 得到本次启动的第三方描述。
- `web/plugin.ts`：浏览器入口从自己的激活上下文取得 `nbook.plugins/registry` 的客户端，闭包传给 `load()` 返回的页面组件；不扩张设置窗口给页面的上下文。

## S1d 宿主接入

- **服务端**：`start.ts` 在装配前取得第三方描述；`requiredPlugins` 仍只取内置插件里的启动必需项，第三方不是启动必需。`StartServerOptions` 增加显式的额外启动必需项，测试注入的故障插件经它声明，恢复 `server.test.ts` 里四个启动失败、关闭失败用例的前提；发布与关闭顺序的断言改为核对依赖先后与失败隔离，不枚举插件全集。
- **项目子进程**：服务端把本次启动确定的第三方描述经项目启动合同交给每个子进程（与项目 id、状态根同一通道）；子进程按它登记顶层贡献，不自己读登记表，所以同一次服务端运行中后来打开的作品看到的集合不变。
- **引导协议**：`BROWSER_PROTOCOL_VERSION` 升到 3；内置插件只给 id 与版本；第三方插件另带 `locations` 与 `contributions`。窗口 `selectPlugins`：id 以 `nbook.` 开头而构建里没有，或版本不同，仍判 `incompatible` 提示刷新；只有非 `nbook.` 的插件按引导描述合成。
- 安全模式：第三方不进入服务端集合、项目子进程与引导响应。

## S1e 设置页

- 页面内容：列表（名称、id、版本、来源、状态、待生效变化；第三方有启用开关与卸载，内置插件标“内置”、没有操作）、安装（路径输入 + 确认，确认文案写明完全信任）、顶部提示“安装、卸载、升级、启用与禁用在下一次启动后生效”，有待生效变化时提示重启。
- 复用 `nb-ui` 的 `SettingsRow`、`Switch`、`Button`、`Dialog` 与通知；不新建样式体系。

## 内置插件版本与信任

- 应用 `package.json` 的 `version` 改为 `0.1.0`；`PRODUCT_VERSION` 读它；内置插件描述的 `version` 引用 `PRODUCT_VERSION`。
- 信任所有插件（ADR 0027）：删除代理允许清单——内核 `PluginHostOptions.delegation` 与 `ApplicationManifest.delegation`、`src/manifest.ts` 的 `delegatingPlugins`、三个宿主的接线与测试里的配置；`delegation.test.ts` 与示例场景 05 中“不在允许清单被拒”的用例删除。身份对象的来源与寿命核对（`issuedTo`）与合同须在 `remoteDelegates` 里的核对保留。
- 清理代码与示例里的旧说法：`plugins/commands/shared/contracts.ts`、`plugins/state/shared/contracts.ts` 的“只给内置插件”；`examples/plugins/notes/web/plugin.ts`、`examples/README.md`（notes 与场景 05 两行）、`examples/scenarios/04-remote-service.test.ts`、`examples/testing/stage.ts` 的允许清单与“只给内置”。
- 代码落地后：去掉 `runtime/services.md` 输出 13、`runtime/plugins.md` 输出 20、`runtime/plugin-channel.md` 输出 10、`storage/persistence.md` 输出 7 的“（planned）”，并改写三处实现合同（`runtime/application.md` 的 `ApplicationManifest`、`runtime/plugins.md` 的经代理远程调用、`settings/configuration.md` 的 owner 与依赖方向）里的允许清单。

## 声明式样例

`packages/neuro-book/examples/external/declarative/`：只含顶层设置项的插件，设置声明带齐 `layers`（`user`、`project`）与 `applies`，由真实应用登记后贡献为 accepted。另备一个 `files` 含目录 glob 与范围外符号链接的样例，给 S1b 的边界测试用。

## 验收映射

| Spec 条目 | 验证 |
|---|---|
| `plugin-manifest` 输入表、失败与恢复 | S1a 表驱动测试：每个字段的合法／非法各一条，拒绝原因稳定 |
| `plugin-manifest` 输入（两种载体） | S1a 内置插件对齐测试 |
| `plugin-manifest` 输出 11（顶层贡献在每个实例登记） | 真实服务端 + 项目子进程：安装声明式样例 → 重启 → 打开作品 → 用户层与项目层都能写入该设置项 |
| `plugin-install` 输出 1、9（列表、待生效变化） | 服务合同测试（经内核远程调用）；e2e 看到“内置”标记与待生效变化 |
| `plugin-install` 输出 2、3、4、8（安装、卸载、启停、升级） | 真实临时目录 + 真实服务端重启：场景 1、3、12、13 |
| `plugin-install` 输出 6、7（不兼容、安全模式） | 场景 2、7、8 |
| `plugin-install` 状态与转换、提交点、失败码 | 复制抛错（无读权限的源文件）、登记表改名失败、提交前后中断各一条；场景 9；卸载中再安装得到 `uninstall-pending`；待切换期间换版本后中断 |
| `plugin-install` 场景 10（路径部分） | 路径中间段符号链接、末级链接、安装根别名、glob 命中链接各一条；范围外链接不影响安装 |
| `plugin-install` 场景 14、15 | 内置插件列表与 `builtin-fixed`；两个真实服务端进程同时安装不同插件，登记表两条都在 |
| `browser-host` 输出 2、4（第三方描述） | 窗口测试：真正的第三方声明式插件登记；新增内置 id 加旧外壳、内置版本不同仍提示刷新 |
| `settings-window` page 分区 | S1e 组件测试 + e2e 打开设置看到插件页 |

真实浏览器 e2e：用声明式样例安装 → 列表显示“重启后安装” → 重启开发服务 → 设置窗口出现该插件的设置项 → 禁用 → 重启后消失 → 卸载 → 重启后登记表与目录清空。

## 风险与未决

- **`files` 语义**：按 npm 规则实现后，用真实文件树（普通目录、目录 glob、排除项、空匹配、缺失入口）核对，与 Spec 不符时先改 Spec 再改代码。
- **范围外发现**：`src/server/projects/registry.ts` 的 `projects.json` 同样只做进程内串行，与本 Task 的登记表是同类问题；不在本 Work 范围，记入 [w00027 README](../../README.md) 的范围外发现。
