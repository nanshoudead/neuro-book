# 实施计划：浏览器入口装载与插件 SDK（S2–S3）

2026-10-17 起草，待开发者确认。依赖 t03 的清单解析、登记表与引导协议。

## 交付顺序

| 切片 | 内容 | 完成判据 |
|---|---|---|
| S2a | 预检：CSP 与 `new Function` | 真实页面里执行一段登记工厂；确认不需要放宽 CSP；把结论写进证据 |
| S2b | SDK 包与构建预设 | 一个样例目录构建出 `dist/`：生成清单、服务端 ESM、浏览器登记工厂 CJS、样式；纯度检查能拦下打包 Vue／nb-ui |
| S2c | 插件文件端点 | 只读版本目录内的普通文件；越界 400、缺失 404；真实请求测试 |
| S2d | 浏览器装载与注销 | 宿主模块表、`require` 表外模块报 `module-not-shared`、样式随装载／注销增减、失败只影响该入口 |
| S2e | 窗口接入 | 启动时加载第三方浏览器入口；e2e 里视图与命令可用，禁用后重启消失 |
| S3a | 服务端入口装载 | 一代次一份模块实例；`onRemote` 激活；入口停止后不再持有模块 |
| S3b | 示例闭环 | 示例插件同时有浏览器与服务端入口，浏览器经远程服务调用服务端；安装→使用→卸载 smoke |

## S2b SDK 与构建预设

- 新包 `packages/nb-plugin-sdk`（`@notnotype/nb-plugin-sdk`，先 `private: true`）：
  - 再导出内核的纯函数与类型：`defineEntry`、`defineServiceKey`、`defineRemoteService`、`provide`、`providePerConsumer`，以及激活上下文类型。插件只从 SDK 导入，不直接依赖 `@notnotype/nb-runtime`。
  - `buildPlugin({root, outDir})`：用 Vite（`@vitejs/plugin-vue`）分别产出：
    - 服务端入口：单文件 ESM，依赖全部打进来（除 Node／Bun 内置）。
    - 浏览器入口：单文件 CJS，`format: "cjs"`，`external` 为宿主模块表（`vue`、`@notnotype/nb-ui/components`、SDK），产物导出登记工厂。
    - 样式：入口引用的 CSS 汇总成 `style.css`。
    - `package.json`：写入生成的清单（`name`、`publisher`、`version`、`engines.neurobook`、`entries`、`contributes` 等），来源是作者的 `plugin.ts`（与内置插件同一写法：描述加 `defineEntry` 定义）。
  - 纯度检查：构建后扫描浏览器产物，出现 `vue`／nb-ui／SDK 的实现代码即失败，报出模块名；检查在构建脚本里跑一次，不进入产品运行时。
- 浏览器产物合同（写进 `plugin-code-loading` 的 S0 收口）：模块导出一个 `register(require)` 函数，返回该入口的 `activate(context)`；组件作为惰性工厂，首次渲染时才 `require("vue")`。
- 清单生成：`dist/package.json` 是可安装目录的清单；作者源目录的 `package.json` 只用于开发，安装时指向 `dist`。安装器只认带合法 `package.json` 清单的目录，不区分手写与生成（声明式插件可以直接手写清单安装）。

## S2c／S2d 装载

- 服务端：在 `nbook.plugins` 的后端入口注册宿主路由 `GET /api/plugins/:id/files/:version/*`（经 `nbook.http` 的 `hostRoutes`），路径在版本目录内解析后返回；内容类型按扩展名。本轮没有认证，服务端只监听回环地址；Spec 要求已登录才可访问，等认证实现再补。
- 浏览器 `web/host/plugin-code.ts`：
  - 建立冻结的模块表：`vue`、`@notnotype/nb-ui/components`、`@notnotype/nb-plugin-sdk`；`require` 其它 id 抛结构化错误 `module-not-shared`。
  - `loadEntry(plugin, entry)`：取 `main` → `fetch`（带客户端身份）→ `new Function("module", "exports", "require", code)` 执行 → 取 `register(require)` → 得到 `activate`。同一版本同一入口只执行一次；代次结束注销表项与样式。
  - 样式：`<link rel="stylesheet" href="/api/plugins/<id>/files/<version>/style.css">`，注销时移除。
- 窗口：`selectPlugins` 改为 async，第三方 `browser` 入口在被选中前加载；加载失败按 `browser-host` 的失败页处理，内置插件不受影响。

## S3a 服务端装载

- `nbook.plugins` 后端在登记第三方服务端入口时，把一个 `activate` 适配器交给内核：首次激活时 `import(entryFile)`（绝对路径、带查询串避免跨代次缓存），取导出的 `activate`，校验声明一致后调用。
- 一代次一份模块实例：每次激活都用一个新 URL（`?generation=N`）；入口停止后不缓存模块。
- 远程服务：清单的 `remoteProvides` 写合同 id；SDK 产物导出一个合同表，加载时由适配器映射成合同对象。合同版本与 id 不符时激活失败。

## 示例与验收

示例：把现有示例插件改为外置插件作验收载体（开发者 2026-10-17 定），不另写新示例。S2 用 snippets（设置项、page 分区、浏览器代码）；S3 用 clock、notes、counter（服务端入口、远程服务、项目实例、命令）。每个示例保留 `plugin.ts` 与 `defineEntry` 写法，加构建脚本，产物到 `dist/`；进程内场景测试保留，另加“构建 → 安装 → 重启 → 使用”的 smoke。

| Spec 条目 | 验证 |
|---|---|
| `plugin-code-loading` 输出 1、2、3、4、5、8、9 | 单元测试（模块表、表外模块、纯度检查、端点边界）；真实浏览器 e2e |
| `plugin-code-loading` 输出 6、7（回收） | 一轮启用／禁用后的弱引用检查作为可选证据；不承诺结果 |
| `plugin-api` 输入（`defineEntry`、上下文） | 示例插件只经 SDK 编译通过；类型检查 |
| `browser-host` 第三方入口接入 | e2e：安装构建产物 → 重启 → 视图出现在工作台、命令可执行 |
| `plugin-manifest` 入口字段 | 生成清单与手写清单等价：同一份示例手写清单也能通过校验 |

e2e 流程：`bun run build` 示例 → 经 `nbook.plugins` 安装 `dist/` → 重启开发服务 → 打开工作台看到视图、执行命令、看到设置项 → 禁用 → 重启 → 视图与命令消失。

## 风险与未决

- **开工前要决定（t03 设计审查第 7 条）**：清单里 `remoteProvides`、`remoteDelegates` 只有合同 id，内核却要求激活产出的远程合同与声明是同一个对象。合同对象从 SDK 合同模块怎样进入登记、怎样保证激活产物用的是同一个对象，不能靠登记时提前 import 入口代码（违反“登记不执行插件代码”）。第三方拥有的贡献点怎样校验贡献（内置插件用校验函数，清单里只有可序列化的 schema）也在此时定。
- **`version-mismatch`**：第三方插件互相依赖从本 Task 起成立，S3 一并实现受阻推导与场景。
- **CSP**：若页面设有 `script-src`，`new Function` 需要 `unsafe-eval`，与 Spec“不放宽 CSP”冲突。先做 S2a 预检，必要时改为 `<script type="module">` + blob URL 或重新评估方案（会改动 Spec）。
- **共享模块表的打包一致性**：nb-ui 与 Vue 的版本必须由宿主固定，插件构建预设从宿主包读取版本；不一致时装载失败并提示重新构建。
- **SDK 分发**：本轮 `private`，外部作者从仓库取 SDK；正式发布形态（npm 包或 tarball）另定。
- **认证**：文件端点在本机回环下没有鉴权；按 `browser-host` 的认证计划补齐前，不把服务端暴露到非回环地址。
