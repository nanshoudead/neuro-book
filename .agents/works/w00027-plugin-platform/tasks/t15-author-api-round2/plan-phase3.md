# t15 第三期计划：发布 0.11.0、作者从 npm 装 SDK、CI 与文档整理

## 1. Context

第二期产出了能装的应用包与 SDK 包（[plan-phase2.md](plan-phase2.md)，2026-10-27 合入 master），但版本号还是 0.1.0，发布脚本只认 9 个以源码发布的包，作者文档写着“SDK 不发布，先拿 tarball”，根 README 与 CI 停在旧应用时期。本期把应用与 SDK 发到 npm，让“作者 `bunx` 建插件、构建、用户 `nbook plugin install`”这条路只靠 registry 就能走通。`bun publish` 与其它远端写入由开发者执行。

现状（2026-10-27 查）：

- npm 上没有 `@notnotype/neuro-book` 与 `@notnotype/nb-plugin-sdk`（旧应用从没发到 npm，旧 Manager 是另一个包 `@notnotype/neuro-book-manager`，`latest` 0.1.0-canary.4、`canary` 0.1.0-canary.60）。
- `release:publish` 在 `packages/<目录>` 里直接 `bun publish`；应用包与 SDK 包是生成的目录（`build:app-package`、`build:sdk`），不能走这条路。两个包都不依赖那 9 个包（依赖打进 bundle 或打平了类型），可以各发各的。
- 根 README 写的是旧应用：Windows 免安装包、Manager 安装脚本（`scripts/install/` 已在 10-03 删除，链接是死的）、GHCR 徽章、主页截图路径 `vitepress/public/images/…`（目录已不在根上）、“四大核心能力”在 v2 里大多还没有。`packages/neuro-book/README.md` 写着“当前是应用骨架”；`dev-panel`、`owned-process`、`neuro-book-contracts`、`neuro-book-test-support`、`neuro-book-legacy` 没有 README；`PROJECT-STATUS.md` 停在 10-03。
- CI：Code Baseline 与 Workspace Packages 只在 PR 上跑，而现在的做法是本地合入、推 master，所以各包测试 09-12 以后没在 CI 上跑过；推 master 时唯一会跑的 Community and Docs Checks 至少从 10-14 起一直失败：`scripts/ci/validate-community-files.ts` 逐字核对 workflow 内容（要求 governance 的命令里出现 `scripts/ci/workspace-workflows.test.ts` 字样），与 `scripts/ci/workspace-workflows.test.ts` 是同一类检查的两份。选包矩阵漏了 `nb-story`、`owned-process`、`file-snapshot-cache`。

开发者 2026-10-27 定（会话里问答）：

- E1 第一个版本 0.11.0（接在旧应用 0.10.x 之后），npm 标签 `latest`；应用包与 SDK 同一个版本号。README 与包说明写明是预览版。
- E2 根 README（中英两份）只写 v2 已有的；旧的“四大核心能力”改成“路线图”，写明哪些还不在 v2 里。
- E3 旧应用的安装方式从 README 删掉，留一行指向 0.10.x 的 Releases、写明不再维护；`npm deprecate` 旧 Manager 的命令给开发者执行。
- E4 CI：推 master 也跑；e2e 仍在本地跑。开发者补充：现有 CI 是旧应用时期的，过严、过度防御，参考着重新建立，不在旧的上面修补。
- E5 作者入口用 `bunx -p @notnotype/nb-plugin-sdk nbooke create my-plugin`；不建 GitHub Release 与 tag；README 截图两张（书架页、打开作品的工作台）。
- E6 文档用上品牌材料：标志与字标（`.local/brand/logo/06-production/`）、看板娘（`.local/brand/mascot.png`，“神谕叙事织者”设定图）。

依据：[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)、[ADR 0033](../../../../../docs/adr/0033-app-delivered-as-built-npm-package.md)、[repository-workflow 的“npm 包”](../../../../../docs/standards/repository-workflow.md#npm-包)、[`runtime.plugin-api`](../../../../../docs/specs/runtime/plugin-api.md)（`nbooke create`）、[`runtime.cli`](../../../../../docs/specs/runtime/cli.md)。

工作方式：代码与仓库文档在 Work 的 worktree（`.worktree/w00027-plugin-platform`）改，Spec 与 Task 记录在主工作区 master；主会话实现，每片自跑验证、单独提交；计划与实现审查派 omp。开发者参与规划：本计划先给开发者看，定了再审查、实施。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 作者第一次建插件的入口 | `bunx -p @notnotype/nb-plugin-sdk nbooke create <目录>`（Bun 1.4 的 `bunx --package`，已查 `bunx --help`） | 不用全局装 SDK，项目里的 `nbooke` 与 SDK 版本一致；否决 `bun add -g` 全局装（全局与项目两份版本会漂移），否决 `bun create` 模板仓库（还要另维护一个仓库） |
| CI 跑什么 | 与本地验证门禁同一套命令：`governance:check`、`docs:check`、`test:affected --since <基准> --typecheck`（[验证门禁](../../../../../docs/testing/README.md#验证门禁)） | 本地与 CI 一套规则，按改动选包已由 `test:affected` 做；否决保留 CI 专用的写死包矩阵与逐字核对 workflow 内容的元测试 |
| 其余 | 无新依赖 | — |

## 3. 关键设计

### 3.1 版本 0.11.0：`packages/neuro-book/package.json`、`src/shared/product.ts`

- 两处的 `0.1.0` 改成 `0.11.0`（`product.test` 核对两者一致）。内置插件的版本、SDK 包、`engines.neurobook` 的缺省（`^0.11.0`）随之变化。
- 测试里写死的 `>=0.1.0` 仍然满足，不动；写死 `^0.1.0` 当产品版本用的（例如 `src/manifest.test.ts`）改成取 `PRODUCT_VERSION`。示例插件自己的版本（`0.1.0`）与产品版本无关，不动。
- 9 个源码包的版本不动（本期没有改它们的接口）。

### 3.2 发布链：`scripts/release/`

把“生成后发布”的包接进同一套命令，开发者的步骤不变（check、smoke、publish、registry smoke）：

- `packages.ts`：新增 `BUILT_PACKAGES`（应用包与 SDK 包），每项写包名、源码包目录、生成命令（`bun run build:app-package`、`bun run build:sdk`）与生成目录（`dist/app-package`、`dist/plugin-sdk`）。`release:check` 对它们只做不用生成就能查的：源码包的版本等于 `PRODUCT_VERSION`、两包版本一致。生成物本身的检查已在 `pack-app.test.ts` 与 `plugin-sdk/pack.test.ts`。
- `pack-smoke.ts`：两种来源（`--from pack` 用新生成的 tarball，`--from registry` 按版本从 registry 装）都加一段“用户加作者”的闭环，在仓库外的临时目录里：
  1. 应用：`BUN_INSTALL` 指到临时目录后 `bun add -g` 应用包；`nbook --version`；`nbook start --no-open --json --state-root <临时>`，取首页、`health` 为 200，用现有的 Chromium 打开页面看到工作台（书架页）；SIGINT 以 0 退出。
  2. 作者：`bunx -p <SDK 来源> nbooke create hello`（`pack` 模式加 `--sdk file:<tarball>`），`bun install`，`bun run build`，`bun run typecheck`。
  3. 回到用户：`nbook plugin install hello/dist --state-root <同一个>`，`nbook plugin list --json` 里有它；再 `start` 一次，实例应答的启动集合里它是已加载。
- `publish.ts`：门禁加上 `packages/neuro-book` 没有未提交的改动；先跑两条生成命令，再跑 smoke；发布时 9 个源码包仍在各自目录 `bun publish`，两个生成的包在生成目录里 `bun publish`。已在 registry 上的版本照旧跳过。发布顺序：源码包、SDK、应用。
- 发布后的 `release:smoke --from registry` 同时覆盖两个新包，作为发布证据。

### 3.3 SDK 发布后的作者流程：`plugin-sdk/cli.ts`、`create-plugin.ts`、`pack.ts`、作者文档

- `nbooke create` 不再提示“SDK 还没有发布到 npm”：缺省写 `^<SDK 版本>`，装得上。`--sdk` 留着，给仓库里的测试与想用本地 tarball 的作者。`create-plugin.ts` 里“registry 版本装不上”的返回字段与调用方的提示一起删。
- 作者文档（`plugin-sdk/README.md` 的开头一节、模板 README、示例 README）改成：`bunx -p @notnotype/nb-plugin-sdk nbooke create my-plugin`，`cd my-plugin && bun install`，`bun run build`，`nbook plugin install dist`。“从仓库生成 tarball”降为一小段，写给要试未发布改动的人。
- `pack.ts` 模块头里“SDK 不发布”的理由改写：Spec 副本仍随包带，理由换成与这个 SDK 版本一致、离线可读。
- 这一节先确认 `bunx -p` 装到的 `nbooke` 在作者目录里运行 `create` 时，写进 `package.json` 的 SDK 依赖与 `bun install` 装上的是同一个版本（验收在 3.2 的 smoke 第 2 步）。

### 3.4 CI：重建 `.github/workflows/`，删掉 CI 专用的检查代码

参考：CI 只做“本地门禁在干净机器上再跑一遍”，不另立一套规则（很多 Bun、pnpm 单仓库的 CI 都是 install 加 affected 测试两步）。现有三份 workflow（Code Baseline、Community and Docs Checks、Workspace Packages）删掉，换成一份 `ci.yml`：

- 触发：推 `master`、PR、手动（`workflow_dispatch` 时跑全部）。不按 paths 过滤：选不选、选哪些由 `test:affected` 判断，workflow 里不再维护一份路径表。权限只有 `contents: read`；同一分支或 PR 新的一轮取消旧的。
- 基准：PR 用 `pull_request.base.sha`；推 master 用 `github.event.before`，它是全零（新分支）或不在历史里（强推）时加 `--all`。`actions/checkout` 取完整历史（治理检查要核对迁移记录的提交）。
- job `check`（ubuntu，30 分钟）：setup-bun、setup-node（Vitest 与 vue-tsc 的抬头行是 node）；`bun install --frozen-lockfile`；`bun run governance:check --since <基准>`；`bun run docs:check --since <基准>`；`bun scripts/ci/validate-community-files.ts`（只剩 Issue 表单、标签与贡献指南）；`bun run test:affected --since <基准> --typecheck`。
- job `app-package`（ubuntu，30 分钟，与 `check` 并行）：在 `packages/neuro-book` 里 `bun run build:app-package`（含 `build` 与 `check:dist`）、`bun run build:sdk`、`bun run smoke:server`。每次都跑：几分钟，换来“发布用的两个包在干净机器上打得出来”。
- 删掉的检查代码：`scripts/ci/workspace-workflows.test.ts`（逐字核对 workflow 内容）；`validate-community-files.ts` 里核对 workflow 的部分（`validateWorkflows` 与只给它用的常量）；`workspace-package-matrix.ts` 里 CI 专用的写死包表与 `selectWorkspaceMatrix`（`test:affected` 用的依赖图 `workspaceDependencyGraph`、`expandConsumerClosure` 留下，文件按用途改名或并进 `change-scope`，实施时看引用决定）。`agent-governance` 里若有核对 workflow 文件的条目，一并删。
- llmlint 的 Nuxt 网页（`packages/llmlint/web`，自带锁文件）不进 CI：它的构建与上传产物是旧时期给部署用的，改它时本地跑。
- 只在 ubuntu 上跑；Windows、macOS 等桌面端时再加。

### 3.5 文档

- **品牌材料**（E6）：放 `docs/images/readme/`，都是复制件，不手改（同 `src/ui/brand/README.md` 的约定，目录里写一份短 README 说明来源）：
  - 横排字标两份：`neurobook-lockup-horizontal-color.svg`（浅色底）与 `-reversed.svg`（深色底），各约 20 KB，字已转成路径；README 顶部用 `<picture>` 按 `prefers-color-scheme` 切换。
  - 看板娘：从 `.local/brand/mascot.png` 的设定图裁出正面全身像，转 WebP（宽约 360、单张不超过约 300 KB），放在 README 开头一段介绍的旁边。
  - 心情小猫（`png/moods/` 的 128 像素版）少量点缀：例如“写插件”配 `write`、“路线图”配 `idea`，每张几 KB；不每节都放。
  - 应用包的 README（npm 页面）只放字标，用 GitHub 上的绝对地址（npm 不显示包外的相对图片）。
- **根 README（中、英）**：结构依次为字标与一句话、预览版说明、看板娘与介绍、v2 的截图两张（`nbdev shot` 截书架与工作台，转 WebP 放 `docs/images/readme/`）、安装与启动（Bun、`bun add -g @notnotype/neuro-book`、`nbook`、数据在哪）、现在能做什么（书架、工作台、文件资源管理器、Markdown 编辑器、图片与 HTML 预览、设置、插件；按已实现的 Spec 写，不写还没有的）、写插件（`bunx -p … nbooke create`，链到 SDK 的作者文档）、路线图（原“四大核心能力”与对比表改写，逐项标“v2 尚未提供”）、旧版本（一行：0.10.x 见 Releases，不再维护）、npm 包表（加上应用与 SDK）、Workspace 导航、社区、贡献、许可。徽章去掉 GHCR 与 GitHub Release，加 npm 版本。文档站链接改成“旧版文档”。
- **各包 README**：给 `dev-panel`、`owned-process`、`neuro-book-contracts`、`neuro-book-test-support`、`neuro-book-legacy` 各写一份短的（是什么、给谁用、入口、链接 AGENTS.md），沿用 `nb-runtime` 那种十几行的写法；`packages/neuro-book/README.md` 重写成给开发者的：包是什么、`bun run dev`、构建与打包、用户看的 README 在 `scripts/app-package/README.md`。
- **应用包的 README**（`scripts/app-package/README.md`）：标明预览版；写插件一节改成 `bunx -p @notnotype/nb-plugin-sdk nbooke create`。
- **`PROJECT-STATUS.md`**：按现在写（v2 已合入 master、能用的功能、npm 包、交付链现状、已知问题）。
- **`docs/standards/repository-workflow.md`**：“发布授权”去掉“没有新应用的发布链”；“npm 包”一节写进应用与 SDK：版本只改 `packages/neuro-book` 的两处，smoke 与 publish 自动生成两个包。
- **全仓库找旧写法**：`rg` 找“SDK 不发布”“tarball”“新应用尚不可用”“Manager”“neuro-book-windows-x64” 等，在活跃文档里逐处改；`docs/archived/` 不动。

## 4. Spec 与文档改动

- [`runtime.plugin-api`](../../../../../docs/specs/runtime/plugin-api.md)：“SDK 的组成”写明 SDK 发到 npm（`build:sdk` 仍可生成 tarball）；`nbooke create` 去掉“SDK 没有发布时装不上，提示先装 tarball”。
- [`runtime.cli`](../../../../../docs/specs/runtime/cli.md)：Smoke 一行加上 `release:smoke` 的闭环。
- 其余见 3.5（README、PROJECT-STATUS、repository-workflow）。

## 5. 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 版本 0.11.0 | 3.1 | `bun run typecheck`，`bun run test:affected` |
| S2 | SDK 发布后的作者流程与 Spec | 3.3、第 4 节 | `plugin-sdk/` 测试，`plugin-authoring` e2e |
| S3 | 发布链：`BUILT_PACKAGES`、smoke 的闭环、publish 门禁 | 3.2 | `scripts/release` 的 Vitest，`prox bun run release:smoke`（`--from pack`），`bun run release:publish`（不带 `--yes`，只过门禁、列出要发的包） |
| S4 | CI 重建 | 3.4 | `scripts/` 的 Vitest 与类型检查，`bun scripts/ci/validate-community-files.ts`；本机照 `ci.yml` 的步骤跑一遍 `check` 与 `app-package` 的命令（基准取 `HEAD~1` 与 `--all` 各一次）；装了 `actionlint` 就跑一次 |
| S5 | 文档 | 3.5 | `bun run docs:check`，`bun run governance:check`，`release:check`（README 的包列表） |
| 收口 | 合入 master | — | 全量 e2e（先确认没有别的会话在跑 omp 审查），`release:smoke` 再跑一次 |

S2 在 S3 之前：smoke 的作者一步依赖 `create` 不再要 tarball。

## 6. 验收映射

| 判据 | 覆盖 |
|---|---|
| plugin-api 的 `nbooke create`（缺省写 `^<SDK 版本>`、不提示 tarball） | `plugin-sdk/template.test.ts`、`release:smoke` 第 2 步 |
| cli 验收 1、7 从 registry 装的包上成立 | `release:smoke --from registry`（发布后，开发者执行） |
| 版本一致：产品版本、两个生成包、内置插件 | `product.test`、`release:check`、`pack-app.test.ts`、`plugin-sdk/pack.test.ts` |
| CI：推 master 与 PR 都跑本地门禁与两个包的打包 | 本机照步骤跑一遍；推上去之后看一次 Actions 的结果（开发者推送后） |

## 7. 验证

- 本地：每片的自跑验证；收口跑全量 e2e 与 `release:smoke --from pack`（真实 tarball、仓库外临时目录、Chromium）。
- 发布由开发者执行，顺序写进 Task README：合入 master → `bun run release:check` → `prox bun run release:smoke` → `npm login` → `bun run release:publish`，确认后加 `--yes` → `prox bun run release:smoke --from registry`，结果记进证据 → `npm deprecate @notnotype/neuro-book-manager "NeuroBook 0.10.x 的 Manager 不再维护；新版本用 bun add -g @notnotype/neuro-book"`。
- 未验证的边界：GitHub Actions 只有推上去才跑得到（push 由开发者执行），之后看一次结果，失败再修；Windows 与 macOS 上的 `nbook` 仍没有实测（第二期已记）。

## 8. 不做与风险

- 不做：GitHub Release 与 tag（npm 是发布渠道；旧 Releases 页面留给 0.10.x）；CI 里跑 e2e；CI 里的 llmlint 网页构建；Windows、macOS 的 CI；CI 自动发布；官网文档站重建；后台运行（`nbook service`）与旧作品管理命令的合并（都在 Work 的后续事项）；9 个源码包的版本变化。
- 风险：0.11.0 一旦发出去就不能再用这个号。门禁会先跑生成与 smoke，失败就停；smoke 用的是即将发布的那份生成物。
- 风险：`bunx -p` 第一次运行要从 registry 下载 SDK 与构建依赖（Vite 等），直连慢时作者会以为卡住；作者文档写一句“第一次要下载依赖”。

## 9. 待开发者确认

1. 看板娘用 `.local/brand/mascot.png`（神谕叙事织者）的正面全身像（推荐）；`.local/mascot/` 下另有十几张候选母版，要换哪一张告诉我。
2. CI 删掉 llmlint 网页的构建（推荐，它自带锁文件、构建产物原本给部署用）；还要的话保留成一个按需的 job。
