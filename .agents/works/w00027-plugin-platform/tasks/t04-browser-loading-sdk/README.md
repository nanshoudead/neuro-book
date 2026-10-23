---
schema: nbook.task/v2
taskId: t04-browser-loading-sdk
status: active
updated: 2026-10-23
---

# 浏览器入口装载与插件 SDK

## 目标与范围

实现 [t01 plan](../t01-requirements/plan.md) 的 S2–S3：第三方插件的浏览器入口代码从安装目录经插件文件端点取回，与宿主共享 Vue、nb-ui 与 SDK；插件自带视图、命令与服务端远程服务。作者用 SDK 构建预设产出一个可安装的插件目录（生成清单、纯度检查）。

范围（2026-10-23 按设计审查修订，详见 [plan.md](plan.md)）：

- SDK：应用的公开面 `src/sdk/`（`index` 与 `browser`），仓库内经别名解析；`build:sdk` 生成可安装的 `@notnotype/nb-plugin-sdk`（打包的实现、打平的类型、构建预设）。
- 构建预设：作者合同、清单生成（含远程合同与贡献点 schema）、逐入口构建、浏览器登记工厂、共享模块与纯度检查、样式与图标。
- 内核：合同进清单、贡献点 schema、版本范围、第三方入口不挡启动。
- 启动数据带清单与内容摘要、运行版本的跨进程租约、插件文件端点。
- 浏览器装载（宿主模块表、`<script src>` 加登记工厂、样式）与窗口接入；服务端与项目实例装载（每次激活新实例）。
- 升级确认框列出重启后受阻的插件；`entries-not-loaded` 收尾。
- 示例 snippets、clock、notes、counter 外置，经构建、安装运行。

非目标：启用／禁用即时生效（`plugin-hot-plug`，t01 plan 的 S5）与运行中注销；热升级回滚；代码回收的强承诺（按 Spec 尽力回收）；插件市场与在线分发；工作台视图贡献的示例（menu、file-menu 与完整示例在 t05）。

## 行为合同

- [`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)（装载、共享模块表、纯度检查、回收、文件端点、错误边界）
- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（SDK、激活上下文、远程形态）
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（入口 `main`、清单生成）
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（第三方浏览器入口接入、失败页）

实施设计见 [plan.md](plan.md)。

## 当前状态

2026-10-17 建 Task，未开工。依赖 [t03](../t03-manifest-and-install/README.md) 的清单解析、登记表与宿主接入。

2026-10-23 计划按 t02 改过的设置接口核对更新（[plan.md](plan.md)）。开发者定：t04、t05 按 autonomous-delivery 自主推进，照推荐做的决定记进 Work 的待确认清单；本次可以做深入审查（多个、多种模型交叉审查）。

2026-10-23 深入设计审查：omp（默认模型，10 条，写完后因上游额度用完退出，未续跑）、Claude Opus（15 条：阻断 1、重要 8、建议 6）、Claude Sonnet（20 条：重要 14、建议 6），报告在 [`evidences/`](evidences/)。没有不成立的条目，按 plan.md 的“设计审查的处理”修订计划；主要变化：SDK 由应用生成、不建依赖应用的工作区包；浏览器回到 `<script src>` 加登记工厂；服务端每次激活前删模块缓存再装载；`@vue/reactivity` 进共享模块；运行版本的跨进程租约；文件 URL 带内容摘要；贡献点 schema 进清单。照推荐做的取舍记进 Work 的待确认清单。

- 2026-10-23 S2a（`1b6a19fdf`，Spec `a889bd7f3`）：清单 `contracts` 与贡献点 `schema`（纯 JSON Schema）、内核 `manifestOf`、`pluginVersions` 版本要求（必需依赖受阻、可选依赖不注入）、远程校验的 schema 写坏不再留下未处理的 rejection、第三方插件不挡启动。内核 369 例、应用 1354 例（单独跑）通过。
- 2026-10-23 S2b（`bc29ef830`）：SDK 公开面 `src/sdk/`、`settingsPageContribution`、`build:sdk` 生成可安装的 SDK 包（仓库外 tsc 通过）；示例插件只从 SDK 导入，clock 改用宿主时钟。`test:affected` 里 llmlint 的 web 测试因缺 Nuxt 生成的 tsconfig 失败（主工作区同样缺，与本次无关）。
- 2026-10-23 S2c（`abf503229`）：构建预设 `scripts/plugin-sdk/build-plugin.ts`（作者合同、经 Vite SSR 读声明、逐入口构建、浏览器登记工厂、模块图纯度检查、样式包进 `@layer components` 并生成 Lucide 图标规则、清单 `style` 字段），`build:examples`，生成的 SDK 包带上构建预设；测试 12 例（含仓库外用生成的包构建插件）。实施发现：Vite 的 `runnerImport` 不初始化 CSS 插件，改用不监听端口的开发服务 `ssrLoadModule`；Bun 的 `require.resolve` 会套用 tsconfig 路径别名，包根目录改为逐级找 `node_modules`；服务端与浏览器入口写在同一个定义模块里时，服务端产物会带上 `/browser`，纯度检查照常拦下（作者要分模块写，t05 写进作者文档）。
- 2026-10-23 S2d（`2fd4088a6`）：启动数据带清单原文、版本目录与内容摘要；项目子进程的 `plugins` 消息改带安装信息；运行版本的跨进程租约（真实子进程测试：另一个服务端切换版本、移除卸载记录，但本服务端在用的目录留到它退出后才回收）；插件文件端点（真实请求测试编码穿越、摘要不符、符号链接、同版本重装后旧地址 404）；浏览器引导 v4。三处宿主仍只登记第三方插件的顶层声明（`thirdPartyDefinition`），按清单登记入口随装载器在 S2e（浏览器）、S3a（服务端与项目）接上。e2e 发现 S2a 的回归：窗口引入 `semver`（CommonJS）后开发会话白屏，加进 Vite 预构建清单后 `settings`、`plugins` 两组 e2e 17 例通过。
- 2026-10-23 S2e（`c9ca9f6d2`）：浏览器装载器（`<script src>` 加登记工厂、只缓存成功的工厂、每次激活调用一次工厂、四个失败原因）、宿主模块表（页面入口在第一次装载时动态导入，窗口宿主代码不直接引用 nb-ui，Bun 里照常测试）、`thirdPartyDefinitionAt`（三处共用，含合同替换）、窗口按清单登记第三方入口与样式表。e2e `plugin-code.e2e.ts` 3 例：snippets 外置后在产品构建与开发会话里运行（打开分区才取代码且只取一次、图标先显示、能写设置），五个写坏的插件各自原位显示原因、文件找回后重试恢复；`plugins`、`settings`、`browser-host` 三组 24 例通过；单元 bun 1373、Vitest 357。第一轮实现审查（omp、Opus 审后端，Sonnet 审浏览器与 SDK）已在后台启动，范围 `7372a3d9e..c9ca9f6d2`。

- 2026-10-23 S3a（`a6711dd23`）：服务端与项目实例按清单登记第三方入口；服务端装载器经 `Bun.plugin` 给出宿主模块、装载前删掉插件目录下的模块缓存，每次激活是新的模块实例；装载失败只影响这个入口并带原因，模块顶层挂起不挡启动（`loader.test.ts` 4 例）。
- 2026-10-23 S3b（`0475d0370`）：clock、notes、counter 外置，经构建、安装运行；升级确认框列出重启后受阻的插件（`blocked`、`unchecked`，插件管理合同版本 2，Lab 场景 blocked）；`entries-not-loaded` 的失败码、警告与徽标去掉。e2e `plugin-code.e2e.ts` 4 例（加后端示例，核对服务端日志）。

### 第一轮实现审查（范围 `7372a3d9e..c9ca9f6d2`，即 S2a–S2e）

审查者：omp（默认模型，5 条：重要 4、建议 1）、Claude Opus（12 条：重要 5、建议 7）审内核与后端，Claude Sonnet（17 条：重要 8、建议 9）审浏览器、SDK 与构建预设；没有阻断。报告在 [`evidences/`](evidences/)（`impl-review-1-*.txt`）。主会话改内核与后端，构建预设与浏览器装载器各派一个编码子代理（Opus，独立 worktree，报告 `impl-review-1-fix-*.txt`），主会话审 diff、合入后自跑验证。

| 条目 | 处理 | 提交 |
|---|---|---|
| Opus 6（schema 按关键字）、omp 4（外部 `$ref`）、omp 2 与 Sonnet 13.1（入口 id）、Opus 8（问题路径） | 成立，已改：按 JSON Schema 关键字的语义检查，数据关键字只查函数；`$ref` 只能指向同一份 schema 里的位置或 `$id`；入口 id 只许单个文件名段；结构问题的合同路径与语义问题一致，贡献点在两处都按下标。点分路径对含 `.` 的 id 仍有歧义，不改 | `0d7a2c966` |
| Opus 1、10（重装换掉租着的目录） | 成立，已改：新失败码 `version-in-use`；被取代的待切换版本被租着时推迟回收 | `c5118919c` |
| Opus 2（租约写不下起不来） | 成立，已改：租约写失败记诊断、照常启动；写列表失败先放锁；删残留失败只记诊断 | `c5118919c` |
| omp 1、Opus 7、12（锁失效） | 成立，已改：租约锁过期 5 分钟；失效时换名重写并记诊断；准备期之后的诊断接到宿主存储（`connectDiagnostics`）。omp 建议的“失效即停宿主”不采用：代价远大于一次不受保护的窗口 | `c5118919c` |
| Opus 11（文件端点吞错） | 成立，已改：不存在类错误 404，其余 500 并记诊断 | `c5118919c` |
| Opus 4（合同替换无测试、BigInt） | 成立，已改：经真实插件宿主测相同、不同（释放恰好一次）、BigInt；变异检查能抓到 | `c5118919c` |
| Opus 9（摘要整份读） | 部分改：逐块哈希；不设文件数与大小上限（复制也没有上限，要定就一起定） | `c5118919c` |
| omp 5（摘要不绑内容） | 接受取舍：安装目录归宿主、安装后不变；同版本重装已由 `version-in-use` 挡住，手工改安装目录不在保护范围 | — |
| Opus 3（停止等不守规矩的后台激活） | 接受取舍：写进 runtime/application 的已知限制，与激活超时一起做 | Spec |
| Sonnet 11（SDK 公开面） | 部分改：补 `settings.sections`、`settings.choices` 的贡献点与类型，去掉 `settingsPage`、`settingsPageEvent`；`./build` 带类型（构建子代理）；`provide` 是否改名交开发者；`bin` 留给 t05 | `c1bcbf0ff` |
| Sonnet 8（e2e 覆盖） | 部分改：图标按遮罩图与尺寸断言。主题、语言、nb-ui 浮层不补 e2e：插件组件经宿主模块表用同一份 nb-ui 与 i18n，身份由 `plugin-modules.dom.test.ts` 核对 | `a41cdb0ad` |
| Sonnet 1 与 Opus 5、2、4、5、6、10、12（minify）、13、16、17 | 成立，已改（构建子代理）：动态导入纳入纯度检查、浏览器里经 `require`；图标扫清单与全部入口、非 Lucide 警告；SDK 包补 `@vue/reactivity` peer；宿主 Vue 包改显式四个、未共享写引入者；中间产物放输出目录旁；工厂严格模式；浏览器产物压缩（snippets 103 KB 到 22 KB）；`readAuthor` 错误、source map 路径；`import.meta.url`；输出目录只清理自己的产物 | `0c96891fe` 合入 |
| Sonnet 3、7、9、14、15，omp 3 | 成立，已改（装载器子代理）：等待表放进全局登记对象、同一 URL 多个等待者；宿主模块表失败不缓存、包成 `code-load-failed`；停止时立刻结束并撤下脚本；`plugin-code.test.ts` 11 例与窗口样式用例 | `eef633400` 合入 |
| Sonnet 12（typebox 不共享） | 交开发者：每个插件各带一份 typebox（压缩后仍是大头），进共享模块表就成为兼容承诺 | — |

合入后验证：`test:affected --since 0475d0370` 通过（nb-runtime 377、应用 bun 1409、Vitest 358）；两包 typecheck 通过。全量 e2e 289 例通过（Work 分支 `a41cdb0ad`，29.7 分钟）。

### 第二轮实现审查（深入审查，范围 `c9ca9f6d2..a41cdb0ad`，即 S3a、S3b 与第一轮的修正）

审查者：omp（默认模型，9 条，都是重要）与 Claude Opus（11 条：重要 5、建议 6）交叉审内核与后端，Claude Sonnet（12 条，都是建议）审浏览器、构建预设、SDK 与插件页；没有阻断。报告在 [`evidences/`](evidences/)（`impl-review-2-*.txt`）。omp 与 Opus 重合的：升级预览与内核不一致、`$ref` 解码抛错、`dependencies` 漏检、租约重写与放下竞争、服务端缺失模块分类。

| 条目 | 处理 | 提交 |
|---|---|---|
| Opus 6、omp 2、3（`$ref`、`dependencies`、`$anchor`）、Opus 7（数据位置只查函数） | 成立，已改：清单校验器永不抛错；数据位置只接受 JSON 值；支持 `$anchor` 与 draft-07 `dependencies` | `bcbaf1f8b` |
| Opus 4、omp 1、7、9（升级预览） | 成立，已改：列出插件自己的服务以定义为准，去掉或挪走提供项推出缺服务；禁用的插件不列；目录清单的 id、版本对不上的列为没核对；同一插件按原因分行；原因加 `missing-service`、`dependency-cycle` | `bcbaf1f8b`、`c34d30f79`、`0ceaab80b` |
| Opus 1、2、3、8、11，omp 6（服务端装载） | 成立，已改：按真实路径删模块缓存；`onLoad` 扫导入报 `module-not-shared`（Bun 的运行期 `onResolve` 看不到已装载模块里的静态导入，实测）；相对导入缺文件为 `code-load-failed`；入口求值失败后重试加查询串强制重新求值；宿主模块失败不缓存；错误带 `cause`；`activate` 没返回对象报 `code-shape` | `c34d30f79` |
| Opus 5、9，omp 4（租约） | 成立，已改：重写排队、放下等重写结束、放下之后完成的重写立刻放掉；过期时间可注入并补锁失效重写与推迟回收的测试；停止之后的诊断写到 stderr；`version-in-use` 按原因写详情 | `c34d30f79` |
| Opus 10（注释挂错） | 成立，已改 | `173553b4a`、`c34d30f79` |
| omp 5（同一插件的入口不共享子模块） | 不改：构建预设把每个入口打成一个文件、浏览器每个入口一个工厂，入口之间本来就不共享模块；写进装载器头注释与 Spec | `d2d13cf1a` |
| omp 8（锁外启动的租约窗口） | 接受取舍：拿不到登记表锁本来就是降级启动、记诊断；先写租约再读清单，窗口里被回收的读清单时不登记或激活时 `code-load-failed`；写进代码注释 | `0ceaab80b` |
| Sonnet 1、12（装载器已停止的激活、共用文件的失败归属） | 成立，已改，补测试 | `173553b4a` |
| Sonnet 2（浏览器入口顶层 await） | 成立，已改：打包错误换成 `PluginBuildError`，说明原因；Spec 写明 | `173553b4a` |
| Sonnet 3、4、5、6（插件页文档、列表连接与换行、注释、Lab 场景） | 成立，已改：`PluginsPage.md`、`Intl.ListFormat`、`overflow-wrap`、Lab 加 `blocked-english`、`version-in-use` | `173553b4a` |
| Sonnet 7（e2e 只断言“没看到失败”） | 成立，已改：要求日志里有 counter 服务端入口的 `published`；项目子进程的入口仍只在场景测试里覆盖 | `173553b4a` |
| Sonnet 8、9（中间产物位置、`buildExample` 删源码） | 成立，已改：中间产物放进输出目录；输出目录不能是示例目录或上级，上次产物要有 `entries` | `173553b4a` |
| Sonnet 10、11（`./build` 声明要求 ES2022、SDK 声明与测试） | 成立，已改：作者项目按 `lib: ES2020` 检查；导出 `OptionSource`；作者项目写 list 分区与选项来源；改掉指向已删导出的注释 | `173553b4a` |

验证：`test:affected --since 0475d0370` 除 nb-story 一例在并行负载下超时（单独重跑通过，本范围没改 nb-story）外全部通过；两包 typecheck 通过。

## 下一步

全量 e2e 通过后合入 master；t05 的设计审查已启动。
