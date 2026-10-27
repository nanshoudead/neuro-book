# deepseek-harness（dsh）调研：发行、自写扩展、桌面版，对照 NeuroBook

调研对象：`deepseek-ai/deepseek-harness`，提交 `22ddee3`（2026-10-23），源码在 `src/`。npm 包下载到 `scratch/tar/`。路径简写：`src/` 指上面的浅克隆。

## 先说结论

1. dsh 的“伴随源码”不是随包发源码：npm 包里只有未压缩的 ESM 构建产物（`lib/*.js` 加 `lib/types/*.d.ts`），没有 `src/`。agent 读到的“宿主源码”是 README、`.d.ts`（带 JSDoc）、`lib/` 里可读的 JS；只有源码检出（`git clone` 加 `pnpm run build`）才有 `src/`。依据见第 1 节。
2. dsh 的“自己给自己写插件”靠三样：(a) 插件 bundle 是不需要构建的纯 JS 包（目录、`package.json`、YAML 补丁、`index.js`）；(b) 专门的 Creator 预设内置 Skill 加模板加运行时检视工具；(c) `plugin_manager install_bundle` 工具，用 `link:` 安装并通过 HMR 热装载。见第 2 节。
3. 桌面版是 Electron 壳，和命令行同一份代码（同一个 `@deepseek-ai/dsh` 依赖树放进 `app.asar/dsh`），捆绑 Node（Electron RunAsNode）与 pnpm，插件放在 `$DSH_HOME/profiles/desktop`，同样能用 Creator。见第 3 节。
4. 对 NeuroBook：dsh 的作法有两处直接和 ADR 0033 冲突（不打包依赖、插件不构建）；可借鉴的是“Skill 加模板随包”“插件入口允许不构建的纯 JS 形态”“agent 用工具安装并热生效”。见第 4 节。

---

## 1. 分发：发什么、什么形态

### 1.1 发到 npm 的包

- 对外入口包 `@deepseek-ai/dsh`，`bin` 为 `{"dsh": "lib/bin.js"}`（`src/apps/cli/package.json`；npm 上 `npm view @deepseek-ai/dsh` 的 `bin` 相同）。dist-tags：`latest` 为 0.2.1-rc.2，`next` 为 0.2.1-rc.4，`alpha` 为 0.2.1-alpha.5（`npm view`，2026-10-27）。仓库里的版本是 0.2.1-rc.3（`src/package.json`）。
- 入口包本身很薄：`npm pack @deepseek-ai/dsh` 得到 20 个文件、unpacked 76 KB（`dist.unpackedSize 75972`），`files` 为 `lib/*.js` 与 `lib/types/*.d.ts`（`apps/cli/package.json`）；`lib/bin.js` 11.8 KB。
- 能力全在它的 `dependencies` 里：约 80 个同版本精确锁定的 `@deepseek-ai/dsh-*` 包（如 `dsh-tool-fs`、`dsh-web-app`、`dsh-plugin-manager`、`dsh-experimental-*-bundle`），加 `@deepseek-ai/cordis*`、`commander`、`js-yaml`。也就是说依赖是装进 `node_modules` 的，不是打进单文件（`npm pack` 解开的 `package.json`）。
- 每个子包单独发布，格式一致，实测几个：
  - `dsh-tool-fs` 180 KB，`dsh-tool-cordis` 752 KB，`dsh-web-app` 156 KB，`dsh-plugin-manager` 608 KB；
  - 内容是 `lib/index.js`、`lib/types/**/*.d.ts`、`locale/*.json`、README（英中两份）、LICENSE，`dsh-web-app` 还带 `cordis.patch.yml` 与 `presets/*.patch.yml`；没有 `src/`（各包 `files` 字段，见 `scratch/tar/*/package/package.json`）。
  - 这些包的 `exports` 里写了 `"./src/*": "./src/*"`，但 `files` 不含 `src`，实际是个空路径（推断：给仓库内工作区解析用）。
- `lib/index.js` 不压缩、保留 JSDoc 与 `//#region` 注释，可读（`dsh-tool-cordis/package/lib/index.js` 开头）。构建器是 tsdown（rolldown），每个包单独构建，只出 ESM，`minify` 未开（`src/tsdown.config.ts`：`format: ['esm']`、`target: 'es2024'`、`dts: false`，类型由 `tsc` 另出）。
- 另外还有：Python SDK（`python/`，`python-release.yml`）、`@deepseek-ai/node-addon-system` 原生模块（`native/`，`node-addon-system-release.yml`）、vendored Cordis 框架（`vendor/`，重命名作用域后另一个发布序列 `release-vendor-publish.yml`）。

### 1.2 运行时与安装命令

- 运行时是 Node，不是 Bun：`engines.node >=24.9.0`（`src/package.json`）；包管理用 pnpm 11（`packageManager`）。源码启动用 `node --import tsx/esm`（`AGENTS.md` 的 Conventions 一节）。
- 官方推荐的安装：不装，直接 `npx @deepseek-ai/dsh web`（`README.md` 的 Run 一节）。没有安装脚本、没有 `npm i -g` 的官方写法（我在 README、`docs/user`、`apps/cli/README.md` 里搜过 `npm i -g`、`install.sh`，没有命中）。从源码：`git clone`、`pnpm install`、`pnpm run build`、`pnpm dsh web`。
- 插件管理需要 PATH 上有 pnpm：`dsh plugin` 把参数转给 `pnpm`，“pnpm must be on PATH”（`apps/cli/reference/README.md:83`）。桌面版则自带 pnpm（见第 3 节）。

### 1.3 许可证

- dsh 本身 MIT，版权方 DeepSeek（`src/LICENSE`、各包 `"license": "MIT"`）；第三方依赖的许可在 `THIRD_PARTY_NOTICES.md`。

### 1.4 发布脚本与 CI

- `.github/workflows/release-publish.yml`：手动触发（`workflow_dispatch`），明确不监听 push 与 PR。分两个 job：
  - `pack`：`pnpm install --frozen-lockfile`、`release:verify --family dsh`、`build:official`、`release:pack --family dsh --out dist/npm`；另打包 vendor 框架与 Landlock 入口供验证；再 `release:verify-packed-install`，把打好的 tarball 装进干净环境验证；上传 artifact。
  - `publish`：环境 `npm-publish`（需要审批者），`pnpm install --ignore-scripts`、下载 artifact、`release:publish --family dsh --from dist/npm`，用 `NPM_TOKEN`。注释写明“发布上传的是 pack 阶段产出的字节，发布 job 不构建”。
- `ci.yml` 里有 `verify-package-dependencies`、`verify-npm-install-layout`（`.github/workflows/release.yml:84-87`）；还有 hygiene（publint 等，`AGENTS.md` Commands）。流程说明在 `.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md`，我没有通读。

### 1.5 “伴随源码发布”到底是什么

- 用户机器上读得到什么：`node_modules/@deepseek-ai/dsh-*/lib/**/*.js` 与 `.d.ts`、README。读得到、也能改，但改的是构建产物；没有源码映射（包里未见 `.map`，各包 `files` 也不含）。改了以后需要重启；HMR 只对插件源码与配置生效，且不是对 `node_modules` 里的宿主包（见 2.4）。
- agent 参考宿主源码的约定写在 Skill 里：先检视工具，再读 `packageDir` 下 README，最后才读“built `lib/` 或检出里的 `packages/<group>/<name>/src`”（`src/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md` 的 Knowledge sources 一节：“installed packages ship built `lib/index.js` and `lib/types/**/*.d.ts` with JSDoc ... not `src/`; a source checkout of DSH has `.../src`”）。
- 所以 dsh 对“伴随源码”的真实答案是：读 README 与带 JSDoc 的 `.d.ts` 为主，读 `lib` 为辅，源码要自己 `git clone`。它的 AGENTS.md 要求每个导出都写 JSDoc（`verify-export-jsdoc` 机检）、每个包两份 README，这是它“不带源码也能让 agent 看懂”的前提。

---

## 2. 装好后自己给自己写插件

dsh 有两层“扩展”，容易混：
- **bundle（持久插件）**：本节主题。agent 在工作区写一个包，用工具装进当前 profile。
- **动态 Cordis 插件（cordis-host-runner / client-runner）**：在沙箱里按源码即时求值的“生成插件”，现在 README 称其为“historical”，Creator 与 Standard 都改走 Plugin Manager（`src/packages/extensions/README.md` Summary：“Standard and Creator modes install persistent plugins through Plugin Manager”）。下面只讲 bundle。

### 2.1 扩展放哪里、长什么样

- 概念：**bundle** 是带 `dsh.bundle` 清单的 npm 包，贡献一份 YAML 补丁（往配置里插或覆盖插件行）；**profile** 是 `$DSH_HOME/profiles/<name>` 目录，列出有序的 bundle 清单，里面还有用户自己的 `cordis.patch.yml`（`src/docs/user/develop/basic/publish.md` 的 Two concepts 一节）。
- 作者写的目录最少三个文件（同上）：
  ```
  hello-plugin/
  ├── package.json       # "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
  ├── cordis.patch.yml   # - insert: [{id: hello, name: dsh-hello-plugin}]
  └── index.js           # export const name; export function apply(ctx, config)
  ```
- 入口形式：`export function apply(ctx, config)`，可带 `inject`、`Config`；或默认导出服务类。所有资源在 `apply` 里用 `ctx.effect` 或 `ctx.on` 登记并返回清理（`skills/cordis-plugin-development/references/host-plugin.md` 的 Host plugin export forms 一节）。
- 浏览器端：另有 `client.js`，经 Slots 注册 UI（模板 `skills/cordis-plugin-development/templates/decoration/{index,client}.js`、`references/ui-plugin.md`）。
- 放在哪：作者在**工作区**里写（任意目录）；安装后 profile 的 `package.json` 里依赖记为 `link:/abs/path`（publish.md 的 Install into a profile 一节），清单写入 `dsh.profile.bundles`。项目目录里没有专门的“项目级扩展目录”（我没找到；扩展都是 profile 级，Skill 明确说“Changes affect every session in that profile”）。用户级即 `$DSH_HOME/profiles/<name>`，`DSH_HOME` 缺省 `~/.dsh`。
- 补丁叠加顺序：bundle 清单依次、profile 自己的 `cordis.patch.yml`、`$DSH_HOME/cordis.patch.yml`、命令行 `--patch`；后者按行 id 整行覆盖（publish.md 的 The loading order 一节）。用户不改插件包就能覆盖插件的配置。

### 2.2 怎样加载、要不要构建

- 不需要构建：Skill 明说“A Host-only bundle needs no dependencies, install scripts, or build tool”（host-plugin.md 的 Manifest 一节）。插件就是 Node 能直接 `import` 的 ESM JavaScript（`"type": "module"`），不是 TS。
- 要 TS 的作者自己负责转译：git 安装要求作者在 `prepare` 脚本里构建，pnpm 10 以上默认拦截，用户要在 profile 的 `pnpm-workspace.yaml` 里写 `allowBuilds`（publish.md 的 Installing from GitHub 一节），文档把它定性为“在安装时执行包代码的授权”。发 npm 或 `pnpm pack` 的 tarball 则不需要授权。
- 兼容声明：`engines.dsh` 的 semver 范围，安装与启动时核对（publish.md 的 The bundle manifest 一节；plugin-manager README 的 Version compatibility and exemptions 一节，另有按 `包@版本` 加 `运行时版本` 的豁免文件 `compatibility.json`，需要用户明确接受风险）。

### 2.3 agent 怎么知道该怎么写

这一层是 dsh 最值得看的地方。

- **Creator 预设（内部 id `cordis`）**：Web 里专门一个模式；设置页的“Create your plugin”、插件页 Add plugin 菜单里的“Let the agent create a plugin”、三个导航区的 More 菜单都能一键进入，并往草稿里预填一句本地化的请求，不自动发送（`src/packages/client/ui-agent-preset/README.md:36-38`、`packages/client/ui-entry-customization/README.md:33`）。
- **随 npm 包带的 Skill**：`@deepseek-ai/dsh-agent-preset` 包的 `skills/` 目录，Creator 模式通过 `skill-filesystem` 挂载（`packages/preset/agent-preset/README.md:50`）。四个：
  - `cordis-plugin-development`：流程加 `references/`（host-plugin、ui-plugin、mcp-bundle、practices、user-actions、verification，合计约 19 KB）加可拷贝的 `templates/`（decoration 与 mcp 两套，含 7 种语言的 locale 与 icon.svg）；
  - `editing-cordis-compositions`、`cordis-composition-reference`（其 `references/packages.md` 由 `scripts/gen-plugin-packages.ts` 生成并在 `doc-sync` 里查新鲜度）、`agent-experience`。
  - 每个 `SKILL.md` 控制在 8192 字符以内，因为标准预设的工具结果裁剪器会裁掉更长的结果（agent-preset README:50）。
- **运行时检视工具**：`cordis_inspect_list`、`cordis_inspect_query`（`@deepseek-ai/dsh-tool-cordis`，只读）。agent 用它查真实的服务方法、事件、插件配置的 JSON Schema（`Config.listConfigs`，返回 `packageDir`）、当前可用工具、客户端 Slots 与主题变量（SKILL.md 的 Knowledge sources 一节）。也就是说“当前宿主的 API 长什么样”不靠文档，靠活的运行时自省。
- **知识来源顺序**（SKILL.md）：1. 检视；2. `packageDir` 下 README；3. 已安装包的 `lib/index.js` 与带 JSDoc 的 `lib/types/**/*.d.ts`，源码检出才有 `packages/<group>/<name>/src`。
- **流程里的纪律**（SKILL.md 的 Deliver a working plugin first）：先交一个小而能跑的版本，先安装再打磨视觉；安装结果的 `application` 与 `warnings` 才是“是否生效”的证据，不看日志；必须有本地化标题、描述与图标（不许用默认图），写明例外理由。
- **agent 能不能读宿主源码**：Standard 与 Creator 下 agent 有文件工具，但宿主源码只在源码检出里；Desktop 里 Skill 所在目录在 `app.asar` 内，shell 与 glob 打不开，只能用宿主进程的文件读取工具（SKILL.md 的 Read next 一节）。npm 全局用户读 `lib/` 与 README。
- 示例 prompt 写在文档里：“Configure the MCP server at `<endpoint>` in this profile as `demo`. Make its tools available now, then call its ping tool and tell me the result.”（`docs/user/develop/practice/dynamic-cordis.md`）。

### 2.4 改了怎样生效

- 安装：agent 调 `plugin_manager` 的 `install_bundle`，`target` 为包的绝对路径；工具代办 `pnpm add`、写 profile 的 `package.json` 与补丁。Skill 禁止 agent 自己写 profile 文件、在 `$DSH_HOME` 下建包、或在 profile 里跑 pnpm（SKILL.md 开头）。
- 热生效：profile 开了 HMR 时，安装结果 `application: applied`，新插件在同一会话里直接可用（dynamic-cordis.md）。没开 HMR 返回 `restart-required`。HMR 缺省 `root: []`，只处理配置与 bundle 清单变化，不监视插件源码；要监视源码要在 profile 补丁里把 `hmr` 的 `root` 设成 `["."]`（`packages/boot/hmr/README.md` 的 Use this package 一节）。
- 已安装插件的代码被改：“replacing an installed package requires restart to load a fresh JavaScript module generation”（host-plugin.md 末段）。所以“让 agent 改自己刚写的插件”这一步实际是重装加重启，不是秒级热重载（除非作者开了源码 HMR）。
- 启停与卸载：`set_plugin`、`set_bundle`、`remove_bundle`，同一个工具。

### 2.5 信任模型

- `plugin_manager` 的每个动作（含 `list_*`）都要 `danger-full-access` 或逐次审批；批准不改变会话的权限模式（plugin-manager README 的 Use this package 一节）。
- 已装的 Host 代码“在进程内执行、在工作区沙箱之外”（同上）。没有对扩展的能力限制；插件就是宿主进程里的 Cordis 插件。
- 构建脚本要用户另行授权（`allowBuilds`、`approvedBuilds`，agent 只在用户于对话中批准后才可传入）。
- 兼容性不满足时拒绝安装；用户要放行必须显式接受风险（`acceptRisk: true`）。

### 2.6 扩展的分发与安装

- `dsh plugin add <spec>`（转发 pnpm）：npm 包名、目录（`link:`）、`.tgz`、`github:you/repo#sha`（publish.md）。
- Web 的 Plugins 页：安装、启停、移除、更新（`listVersions`/`updateBundle`）、详情页（bundle 的 README 或 `meta.detail`）。
- 实验性的“Custom plugin indexes”包：Discover 页读一个 JSON 索引（`format: 1`，每个插件列版本与来源，来源是 npm 或 git 的 commit 加路径）；dsh 不内置任何索引源，用户自己加 URL；仓库里有参考生成器 `apps/plugin-market-generator`（`docs/user/guide/plugin-market.md`）。发现机制：给仓库打 GitHub topic `dsh-plugin`（README 的 Community 一节）。

### 2.7 一条真实流程：从一句话到生效

按 `dynamic-cordis.md` 与 Skill 还原（Web、Creator 模式、HMR 开启；以下为从文档推出的步骤，我没有实际运行过）：

1. 用户在插件页点“Let the agent create a plugin”，进入一个新的 Creator 会话（`cordis` 预设），输入：“在输入框下面画个徽章。”
2. agent 的 Skill 描述命中“visual object … decoration … widget request that names no other destination”，加载 `cordis-plugin-development`；不指定位置时默认目标是当前 Web UI。
3. 用 `cordis_inspect_list`、`cordis_inspect_query` 查客户端 `Slots` 与所选槽位的注册选项和 props。
4. 用文件读取工具读 `templates/decoration/*`，用文件写入工具把拷贝写到工作区一个目录：`package.json`（含 `dsh.bundle`）、`cordis.patch.yml`、`index.js`、`client.js`、`locale/*.json`、`icon.svg`。语法检查与清单检查。
5. 调 `plugin_manager`（`install_bundle`，`target` 为该目录绝对路径）。弹审批（除非 Full access）。工具跑 pnpm、改 profile、触发 HMR 重组合。
6. agent 读结果：`application: applied` 才算生效；再用 `cordis_inspect_query` 确认新行已挂载，必要时在页面里看实际渲染；核对标题、描述、图标。
7. 有问题就在同一个插件里改，再装一遍（改已装包要重启才加载新代码）；完成后汇报位置、验证状态与限制。

---

## 3. 桌面版

- **位置与壳**：`src/apps/desktop`（主进程、`src/*.ts`、预加载脚本、`renderer/`、`packaging/`、`publishing/`、`windows-signing/`），另有 `apps/desktop-host`（Host 进程的 tsdown 配置）。壳是 **Electron**（`electron ^44.7`、`electron-builder ^26.17`、`electron-updater ^6.8`，`apps/desktop/package.json`）。
- **运行时**：自带，不用用户的。dsh 在 Electron 的 `ELECTRON_RUN_AS_NODE=1` 子进程里跑，另带独立的 Node.js、pnpm 与 Python 发行（含 numpy、pandas、python-docx 等）；用户不需要装 Node 或 pnpm（`apps/desktop/README.md` 的 Key technical decisions 表，Runtime 行）。
- **和命令行是否同一份代码**：同一份。“Electron and `@deepseek-ai/dsh` always have the same exact version”，dsh 的完整生产依赖树随应用放进 `resources/app.asar/dsh`（同表 Release identity 与 Package sources 行）。桌面主进程加载 `dsh-app://app/` 的打包好的 Web 应用，Host 在子进程里服务它；也就是“Electron 套完整的 dsh Web 应用”（README 的 Application overview 一节）。命令行与桌面各有自己的 profile、不共享可执行包与 `node_modules`，只共享 `$DSH_HOME` 下的产品数据（同表 State ownership 行）。
- **打包与签名**：`electron-builder`，脚本 `package-target.ts`（mac-arm64、mac-x64、win-x64，加 `--unsigned`、`--dir`）；macOS 公证（`@electron/notarize`）；Windows 用 EV 证书与硬件令牌签名，对运行时内全部 PE 文件逐个验签、批量签名（README 的 Bundled workspace dependencies 一节、`windows-signing/README.md`）。有 Windows NSIS 安装器（`installer/`，八种语言）。
- **自动更新**：`electron-updater`；启动异步检查固定的 Nightly 通道，间隔十分钟、加减 20% 抖动、失败翻倍退避到一小时；有强制更新策略（`mandatory-update-policy`）；下载后弹出重启确认，重启前问 Host 有没有未完成任务（README 的 Updates 一节）。
- **分发**：不是 GitHub Release，而是自家 CDN：上传到腾讯云 COS（`cos-nodejs-sdk-v5`），生产源 `https://download.deepseek.com`，路径 `dsh-desk/feeds/<target>/` 与 `dsh-desk/bin/<target>/`；有测试与生产两个环境（`apps/desktop/publishing/README.md` 的 Deployment and test release identity 一节）。CI 在自托管的 macOS 与 Windows 机器上打包，`desktop-publish.yml` 做可续传的发布。仓库 README 没有给桌面版下载链接（只写 npx 与源码两种运行方式），桌面版入口我没查到（推断：在 deepseek.com 的页面上，未核实）。
- **桌面里的扩展**：同样可用，且同一个 Web Plugin Manager 与 Creator。Electron 独占 `$DSH_HOME/profiles/desktop`；打包版不创建包链接，用运行时解析；开发版用文件系统链接；宿主与插件在同一个 Electron Node 进程里（README 的 Installation ownership 一节）。额外：菜单“Manage dsh Command…”把 `dsh` 命令装到 `/usr/local/bin`（macOS）或用户 PATH（Windows），关掉桌面版后可用 `dsh plugin --profile desktop add <包>` 管理桌面插件，npm 安装的 dsh 改不了桌面 profile（同节与 Bundled command runtime 一节）。
- 桌面版的代价（文档自己写的）：Skill 目录在 `app.asar` 里，shell、glob 与 pnpm 都打不开，要用宿主文件读取（Skill 的 Read next 一节）；桌面 Python 与 Node 发行带来大体积与逐文件签名工作量（推断：从上面的签名流程看）。

---

## 4. 对照 NeuroBook

NeuroBook 一侧依据：ADR 0033、ADR 0030、`packages/neuro-book/plugin-sdk/README.md`。

| 维度 | dsh | NeuroBook（当前决定） |
|---|---|---|
| 分发形态 | npm：薄入口包加约 80 个同版本子包，每包不压缩的 ESM `lib/` 加 `.d.ts`，依赖由 npm 装进 `node_modules`；桌面版另发安装器 | npm 单包 `@notnotype/neuro-book`：`server/nbook.js`、`project.js`、`web/`，依赖全部打进 bundle，包无 `dependencies`（ADR 0033 决定 1） |
| 运行时 | Node >=24.9；桌面版捆绑 Electron Node | 用户自己装 Bun；桌面版另议（决定 6、后果） |
| 安装命令 | `npx @deepseek-ai/dsh web`；无官方全局安装写法 | `bun add -g @notnotype/neuro-book`，命令 `nbook`（决定 2） |
| 许可证 | MIT | AGPL（ADR 0033 后果：“AGPL 的源码以仓库地址与构建所用的提交提供”） |
| 源码可读性 | 包里无 `src/`；读 README、带 JSDoc 的 `.d.ts`、可读的 `lib`；源码要 clone | bundle 是一个 1.8 MB 级的单文件，源码靠仓库地址加提交 |
| 扩展形态 | bundle：目录加 `dsh.bundle` 清单加 YAML 补丁加纯 JS，Host 与 Client 分文件 | 插件包：`nbooke build` 产出 `dist/`，清单由构建读描述符生成；TS、Vue、多运行位置（SDK README） |
| 构建步骤 | 无（纯 JS）；要 TS 则作者自己转，git 安装靠 `prepare` 加 `allowBuilds` | 必须：SDK tarball 加 `bunx nbooke create` 加 `bun run build`（SDK README） |
| 生效方式 | HMR 热装载（`applied`）；改已装代码要重启 | 安装、升级、启停、卸载都在下一次启动后生效（SDK README 前置条件） |
| agent 自写扩展的支撑 | Creator 预设加四个 Skill（流程、references、模板）加运行时检视工具加 `plugin_manager` 工具；作者入口在 UI 里 | 没有：作者材料是给人看的 README、`docs/*.md`、示例插件；SDK 不发布到 npm，要靠 tarball |
| 信任模型 | 进程内、无沙箱；安装要 Full access 或逐次审批；构建脚本另批 | 清单、权限与应用门禁由内核定（ADR 0030 内核与应用无关）；本次没有细读 |
| 桌面版 | Electron，同一份依赖树，捆绑 Node 与 pnpm，COS 加自动更新，同一个插件管理 | 无；后续在 Electrobun、Tauri、Electron 里实测后选，Bun 当独立进程（ADR 0033 决定 6） |

### 4.1 如果 NeuroBook 要“随源码发布”

dsh 的真实做法是“随包发可读的构建产物加类型加文档”，不是源码。NeuroBook 要做得比 dsh 更进一步，可选的几样：

1. **在包里加一个 `source/` 目录或单独一个源码包**（dsh 没有这样做，这是我的推断，不是借鉴）。依据：ADR 0033 的包是 bundle，用户想读源码只有“仓库地址与提交”；而 ADR 0029 已经决定“工作区包以源码发到 npm”，决定 6 把新应用排除在外。改动：补充 ADR 0029 决定 6 与 ADR 0033 决定 1（包增加源码目录或配套包）；`scripts/pack-app.ts` 要复制源码并核对许可与第三方代码；代价是包体增大、要维护“源码与产物是同一提交”的检查。`bun build --sourcemap` 打进 `.map` 是更小的版本，但读地图不如读源码顺手（推断）。
2. **dsh 的实际做法：每个导出要有 JSDoc，让 `.d.ts` 自带文档**（`AGENTS.md`：“Every module and export has concise JSDoc … enforced by `verify-export-jsdoc`”）。NeuroBook 的 SDK 已经发 `docs/exports.md` 等附表，能借的是“导出的 JSDoc 机检”。不改任何已定决定，代价是写文字。

### 4.2 如果 NeuroBook 要“装好后 agent 自己给自己写插件”

按依赖关系排：

1. **Skill 与模板随应用包发布，并让 agent 能挂载它们。** dsh：`dsh-agent-preset` 的 `skills/` 加 `templates/`（agent-preset README:50）。NeuroBook 现有的作者材料在 SDK 包里（`plugin-sdk/` 的 README、`docs/`、示例插件）；要借的是把“写插件的流程”写成 agent 用的 Skill（每个 `SKILL.md` 控制长度，细节拆到 `references/` 按需读）。改动：ADR 0030 决定 3 说“作者材料留在应用包顶层 `plugin-sdk/`”，现在要把其中一部分作为 Skill 打进 `@notnotype/neuro-book` 的发行包，ADR 0033 决定 1 的包内容清单要加这一项。代价：Skill 与 SDK 文档两份要同步（dsh 用生成脚本加 `doc-sync` 查新鲜度，推断 NeuroBook 也需要类似的机检）。
2. **运行时自省工具，让 agent 查“这个宿主现在有什么 API”。** dsh 的 `cordis_inspect_*`。NeuroBook 的对应物是内核的插件注册表、贡献点与合同（Spec `runtime.plugin-api`）：要新做一个只读工具，把贡献点、服务键、设置模式、贡献的 schema 以 JSON 返回。改动：内核或应用要新增一个“检视”服务；与 ADR 0027 “内置与第三方插件平等”一致（同一个检视面向两者）。代价：新增一个公开面要维护；这是 dsh 能不靠源码也让 agent 写对的关键，我没有对应的替代品。
3. **纯 JS、免构建的插件入口形态。** dsh 的 Host-only bundle 不需要任何构建，agent 写完就能装。NeuroBook 的插件必须经 `nbooke build`（TS、Vue 单文件、清单由构建生成）。要让 agent 写，有三条路，各自改动不同：
   - (a) 允许“手写清单加 JS 入口”的第二种形态：改 `runtime.plugin-manifest`（清单现在由构建读描述符生成）与插件装载的机检；代价是清单与入口不一致的风险回到作者与 agent 身上，而这正是构建生成清单所防的。
   - (b) agent 在用户机器上运行 `nbooke build`：要求用户机器有 SDK（SDK 现在不发 npm，依赖 tarball）、Bun 与（类型检查用的）Node；改动：把 SDK 发到 npm（ADR 0030 后果里写着“随 SDK 的发布另行决定”），并让应用包附带或依赖它；代价：安装体积、构建耗时、agent 运行构建命令要授权。dsh 对“要构建的插件”也只给出作者自己负责（`prepare` 加 `allowBuilds`），没有可借的现成方案。
   - (c) 应用内嵌构建器，提供“从目录构建并安装”的命令（`nbook plugin build`）：把 `nbooke` 的构建预设移进应用包（ADR 0033 的包是 bundle，包不带 `dependencies`，构建依赖要么打进去要么运行时装）；代价最大。
   dsh 的实际选择是 (a) 的等价物。我不能凭它的经验判断哪条对 NeuroBook 最合适，因为 NeuroBook 的插件有 Vue 视图与多运行位置，dsh 的样例里 UI 靠 Slots 加 JS（`client.js`），没有构建的 Vue 单文件。
4. **让 agent 能触发安装与生效。** dsh 的 `plugin_manager` 工具加 HMR 热装载。NeuroBook 现在“重启生效”（SDK README），`nbook plugin install` 是命令行，ADR 0033 决定 5 里 `nbook start` 前台运行、终端拥有服务寿命。要做到“agent 装完就能用”，两条：
   - 做成工具，让 agent 调用，保留“重启后生效”：agent 要自己重启服务端，而服务端又由终端拥有（决定 5），需要后台运行或“请用户重启”；ADR 0033 把后台运行放到后面。
   - 做热装载：要改 `runtime.plugins` 的生命周期（现在是启动时装载）；dsh 用 Cordis 的依赖注入加 Loader 重组合实现，内核没有对应机制（推断）。代价大，需要先查内核的装载模型，我没有读 `nb-runtime` 源码，不下结论。
5. **权限闸。** dsh：每次 `plugin_manager` 调用要 Full access 或逐次审批，构建脚本另批，不兼容要显式接受风险；agent 被禁止直接写 profile 文件。NeuroBook 的 agent 工具与审批模型本次没读，只能说：安装第三方代码等于在宿主进程里执行（dsh 也如此），要把它放在审批后面。

### 4.3 dsh 里不建议照搬的

- “依赖装进 `node_modules`、约 80 个子包”：与 ADR 0033 决定 1（依赖全部打进 bundle、一个单文件起）正好相反。ADR 0033 的背景说明了做这个决定的实测理由（用户先装 Bun、全局包原地升级会在运行中换文件、同一状态根两个实例会丢登记）；dsh 的分发就是 pnpm 依赖树，`npx` 每次装，对 NeuroBook 没有额外好处。
- “桌面版带 Node、pnpm、Python 三套发行加逐文件签名”：dsh 这么做是因为它的 agent 要跑办公类任务，NeuroBook 现在没有这种需求（推断）。桌面方向 ADR 0033 决定 6 已另议。
- COS 加自建更新源：这是 DeepSeek 自家基础设施；NeuroBook 没有对应的依据。

### 4.4 没有查清的

- dsh 官网桌面版下载入口与签名证书细节没核实；`apps/desktop/windows-signing/README.md` 与 `packaging/README.md` 没通读。
- 我没有实际运行 `dsh` 或跑 Creator 流程，第 2.7 节是按文档还原的。
- NeuroBook 一侧只读了 ADR 0033、0030 与 SDK README 的前 120 行，agent 权限、内核装载模型、`runtime.plugin-manifest` 的细节没读，表里相应格子标了“没读”。
