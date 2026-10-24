# t17 实施计划：九个包发布到 npm

## Context

开发者 2026-10-24 定：把 nb-story 发布成 npm 包，只用 Bun 运行，nb-story 依赖的 8 个工作区包一起发布（不打成一个包），许可证照旧 AGPL-3.0-only，加 `nbstory skill install`，更新文档与 README，发布前不做真实模型冒烟（决定见 [Task README](README.md)）。

现状（2026-10-24 查）：

- 9 个包都是 `private: true`，`exports` 直接指向 `.ts` 与 `.vue` 源码，没有构建产物；内部依赖写 `workspace:*`。
- nb-story 的命令行与服务端只导入 nb-harness、nb-runtime、nb-session（nb-profile 经 nb-harness 间接用到）；nb-ui、nb-agent-ui、nb-form、nb-markdown、vue、vue-router、sigma、graphology 系列与 eventsource-parser 只有网页用，网页由 Vite 预先构建到 `dist/web`（2.4 MB，`.gitignore` 忽略），服务端按 `import.meta.dir/../../dist/web` 找它。
- 只有 nb-ui 有 `LICENSE`；nb-ui 写了 `license`，其它都没写。nb-ui 的版本是 `0.2.0-alpha.0`，其余 `0.1.0`。
- 根 `patchedDependencies` 只补丁 nitropack 与 proper-lockfile，9 个包都不用；`overrides` 只有 `diff`，也不涉及。
- `@notnotype/*` 在 npm 上还没有任何包；本机 npm 没有登录。
- 已实测 Bun 1.4.2 的 `bun pm pack`：`files` 里的 `!` 排除生效；会跑 `prepack`；`workspace:^` 写成 `^<版本>`、`workspace:*` 写成确切版本；`private: true` 照样能打包。`bun publish --dry-run` 也要求登录。
- Spec [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md) 写“不发布安装包：第一版从仓库运行”，提案 [`novel-story-app.md`](../../../../../docs/proposals/novel-story-app.md) 写“第一版只从仓库运行，不发布”，`packages/AGENTS.md` 写 nb-story“第一版只从仓库运行”，并要求公开包名、版本、exports 与发布合同先记为跨 Module 决策。
- [ADR 0028](../../../../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md) 已定 nb-ui 由宿主的 Tailwind 编译，与“发源码”一致。

## 技术选型

- **打包与发布**：`bun pm pack` 与 `bun publish`。它们会把 `workspace:` 改写成版本号；`npm publish` 不认 `workspace:`，否决。
- **发布形态**：发 TypeScript 与 `.vue` 源码，不出 `.js` 与 `.d.ts`。运行时只承诺 Bun，Bun 直接执行 `.ts`；Vue 包本来就要宿主的 Vite 与 Tailwind 编译（ADR 0028），和仓库内消费的方式一样，不会出现源码与产物两套。否决“每个包各出一份构建产物”：要给 9 个包配构建与类型产物，仓库内仍用源码，两套会分叉。
- **版本管理**：手工改版本号，加一个发布脚本按依赖顺序发、跳过已发布的版本。否决 changesets：一个维护者、9 个包，每次改动都写一份变更文件的流程收益小；它的 `changeset publish` 走 `npm publish`，不改写 `workspace:`。
- **内部依赖的范围**：`workspace:*` 改成 `workspace:^`，发布后是 `^0.1.0`。只改一个底层包的补丁版本时，上层包不必跟着重发；确切版本会让用户装出两份 nb-ui。
- **Skill 安装**：复制文件，不需要库。

## 关键设计

### 9 个包的 `package.json`

代表路径：`packages/nb-harness/package.json`、`packages/nb-ui/package.json`、`packages/nb-story/package.json`。

- 去掉 `private`；加上 `license: "AGPL-3.0-only"`、`repository`（`git+https://github.com/notnotype/neuro-book.git`，`directory` 写包目录）、`publishConfig: {access: "public"}`、`engines.bun: ">=1.3.14"`（与 nb-story 现有的一致）。
- `files` 用白名单：`src`、`README.md`、`LICENSE`，再排除 `!src/**/*.test.ts`、`!src/**/*.llm.test.ts`、测试夹具目录；nb-ui 另加 `themes`；nb-story 另加 `dist/web` 与 `skill`。`tests/`、`e2e/`、`testing/`、`playground/`、`docs/`、`AGENTS.md`、`tsconfig*.json` 不发。`lab-sources` 这类已经写在 `exports` 里的入口照发：exports 是包的公开接口，这次不改。
- 内部依赖改成 `workspace:^`，包括 nb-story 的 devDependencies。
- 版本：nb-ui 从 `0.2.0-alpha.0` 改成 `0.2.0`，其余 `0.1.0`。全部发到 `latest`，`bun add @notnotype/nb-ui` 不用写 tag；0.x 本身已表示接口未稳定（设计审查第 8 条）。
- nb-story 的依赖按“运行时要不要”重分：dependencies 只留 `@clack/prompts`、`commander`、`openai`、`typebox`、nb-harness、nb-profile（两个 `.profile.tsx` 直接导入，设计审查第 1 条）、nb-runtime、nb-session，其余（网页用的 4 个工作区包、vue、vue-router、sigma 系列、graphology 系列、eventsource-parser）移进 devDependencies。理由：网页已经预先构建，`bun add -g @notnotype/nb-story` 不该装上 Vue、TipTap 与 sigma。代价：以后插件要从 nb-story 引用网页组件时，要把它们放回 dependencies。
- nb-ui 的 `tailwind.css` 用 `@plugin "@iconify/tailwind4"` 并按前缀加载 `@iconify-json/lucide`，这两个从 devDependencies 移进 dependencies；Tailwind 本身仍由宿主提供（设计审查第 2 条）。其它包公开的 CSS 入口照同样的规则查。
- nb-story 加 `prepack: "bun run build:web"`，打包前一定是最新的网页。
- nb-story 加 `os: ["linux", "darwin"]`：书库锁用 `bun:ffi` 调 libc 的 `flock`，只实现了 Linux 与 macOS，Windows 上装不上比装上后才报错好（设计审查第 3 条）。其余 8 个包不限平台。
- 每个包放一份与根目录相同的 `LICENSE`（nb-ui 已有，先比对是否一致）。发布脚本检查 9 份与根目录逐字节相同。

### `nbstory skill install`（`packages/nb-story/src/cli/`）

- 形状：`nbstory skill install [--agent claude|codex] [--dir <目录>] [--force] [--json]`。
  - 缺省 `--agent claude`，装到 `$HOME/.claude/skills/nbstory/`；`codex` 装到 `$HOME/.agents/skills/nbstory/`（Codex 文档的用户级 Skill 目录，2026-10-24 查）；`--dir <目录>` 装到 `<目录>/nbstory/`，相对路径按当前目录解析，与 `--agent` 互斥（同时给退出 2）。父目录不存在时创建。
  - “内容相同”指两边的文件集合与每个文件的字节都相同；目标里多出的文件也算不同。
  - 目标不存在：先复制到同一父目录下的临时目录，再改名成目标。
  - 目标存在、内容相同：不写，`state: "unchanged"`。
  - 目标存在、内容不同：没有 `--force` 时退出 2（`skill_exists`），列出目标路径；有 `--force` 时复制到临时目录，把旧目录改名让开、新目录改名就位，再删旧目录。中途失败时旧目录保持原样，临时目录清掉。`--force` 会删掉目标里用户自己加的文件，Spec 写明。
  - 目标是符号链接或普通文件：一律退出 2（`skill_target_invalid`），不跟随、不覆盖（设计审查第 7 条）。
  - 读写失败（权限等）：退出 1（`skill_install_failed`），信息里写出路径与系统错误码。
  - 输出（`--json` 时 `data`）：`{path, state: "installed" | "unchanged" | "replaced"}`；失败照现有命令的 `{"ok": false, "error": {code, message}}`，标准输出只有这一份 JSON。错误码与输出写进 Spec（设计审查第 11 条）。
- 包里的 Skill 目录按 `import.meta.dir` 找，与 `WEB_ROOT` 同样的做法，从仓库运行和从 npm 安装都对。
- 复用：命令行的退出码与 `--json` 输出外壳沿用 `src/cli/` 现有命令的写法（例如 `config` 子命令）。
- `skill/SKILL.md` 的调用方式改成 `nbstory <命令>`（装好 npm 包后在 PATH 上），从仓库运行的写法留作一句备注。

### 发布脚本（`scripts/release/`）

- `scripts/release/packages.ts`（`bun run release:check`）：9 个包的清单（按目录），从各自的 `package.json` 读依赖，按拓扑顺序排出：nb-profile、nb-session、nb-runtime、nb-ui → nb-harness、nb-form、nb-markdown、nb-agent-ui → nb-story。另外检查：
  - 没有 `private`，有 `license` 与 `files`，`LICENSE` 与根目录逐字节相同，内部依赖都写 `workspace:^`，不依赖清单外的工作区包；
  - 源码里每个非测试文件的值导入（`import … from`、`export … from`、`import()`、CSS 的 `@import`、`@plugin`）指向的包都写在本包的 dependencies 或 peerDependencies 里（设计审查第 1、2 条）。只在构建时用的目录（nb-story 的 `src/web`）对照 devDependencies。
- `scripts/release/pack-smoke.ts`（`bun run release:smoke`）：
  - 把 9 个包 `bun pm pack` 到临时目录，逐个列出打进去的文件，有测试文件、`.env`、`AGENTS.md` 等不该发的就失败。
  - 在仓库外的临时目录建一个 Bun 项目（不继承仓库的 `node_modules`），用 `overrides` 把 `@notnotype/*` 指向这些 tarball（版本号还不在 registry 上），`bun add @notnotype/nb-story`。第三方依赖从 registry 装，慢时在命令前加 `prox`。
  - 在这个项目里跑 `nbstory --help`、`nbstory books --library <临时书库> --json`、`nbstory skill install --dir <临时目录>`（再跑一次得到 `unchanged`）、`nbstory config test`（加载问答 Profile，不调用模型：只到配置不全报错为止的那条路径，具体用哪条命令在实施时按 cli-skill 的输出定）。
  - 起 `nbstory serve --library <临时书库> --json`，用 Playwright 加系统 Chrome 打开登录链接，等书架页的可见标记，断言浏览器没有报错，再打开设置页，然后发 SIGTERM，等它以 0 退出（设计审查第 9 条）。
  - 建一个最小的 Vite 加 Vue 加 Tailwind 宿主，导入 nb-ui、nb-agent-ui、nb-form 与 nb-markdown 的公开入口与 `tailwind.css`，`vite build` 通过。它证明“发源码”对 Vue 消费者可用。
  - `--from registry --version <版本>`：同样的检查，但从 registry 安装、不打包，开发者发布后跑一次作为发布证据（设计审查第 10 条）。
  - 子进程在失败时也要收口；临时目录用 `@notnotype/neuro-book-test-support` 的临时根。
- `scripts/release/publish.ts`（`bun run release:publish`）：
  - 前置检查，任何一条失败都在发布前停下：工作树干净、当前分支是 `master`；`release:check`；9 个包的 `typecheck`；`release:smoke`（设计审查第 5 条）。单测与 e2e 不在这里重跑：它们是合入 master 的门禁。
  - 用 `npm whoami` 确认已登录，没登录就停下并提示 `npm login`。
  - 对每个包用 `npm view <名>@<版本> version --json` 查：只有错误码 `E404` 算“没发布”，其它失败（网络、权限、5xx）立即停下并原样报告（设计审查第 6 条）。
  - 缺省只列出要发的包与版本；带 `--yes` 才按顺序逐个在包目录运行 `bun publish`，`--otp <码>`、`--auth-type <web|legacy>` 原样转给 `bun publish`。一个 OTP 只有 30 秒，9 个包一次发不完，文档建议用 `--auth-type web` 或给发布用的 granular token。
  - 中途失败就停，打印已发与未发的包；再跑会跳过已发的。这一步要开发者先 `npm login`，由开发者自己执行。
- 根 `package.json` 加 `release:check`、`release:smoke`、`release:publish`；三个入口按 `scripts/AGENTS.md` 加进 `scripts/tsconfig.json` 的 `include`，用 `bunx tsc --noEmit -p scripts/tsconfig.json` 检查（仓库没有 `scripts:typecheck` 这个脚本，设计审查第 4 条）。

### 文档

- 新 ADR `docs/adr/0029-workspace-packages-publish-source-to-npm.md`：9 个包作为 `@notnotype/*` 发布到 npm；发源码、只承诺 Bun（Vue 包要宿主编译）；内部依赖 `workspace:^`；版本手工管理、发布脚本按顺序发；首发由开发者执行；不包括新应用的交付链（`monorepo-boundaries.md` 第 73 行那条仍然成立）。
- [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)：边界改成“作为 npm 包 `@notnotype/nb-story` 发布，只用 Bun 运行”；命令表加 `skill install`，加编号输出与验收场景；Skill 的调用方式改成 `nbstory`。
- 提案 `novel-story-app.md`：只追加一行决策记录，正文不动。
- `packages/AGENTS.md`：nb-story 那句改成“以 npm 包发布”，链接 ADR 0029。
- `docs/modules/monorepo-boundaries.md`：在 nb-story 与各包那几行写明“以 npm 包发布”；第 73 行改成只说新应用的交付链。
- `docs/standards/repository-workflow.md` 的“发布授权”：加一段 npm 包的发布步骤（改版本、`release:smoke`、`npm login`、`release:publish --yes`），发布仍要开发者授权。
- README：
  - nb-story 新写 `packages/nb-story/README.md`，给使用者看：装 Bun、`bun add -g @notnotype/nb-story`、`nbstory config init`、导入、`serve`、`ask`、`skill install`、配置文件与密钥环境变量、书库位置、只支持 Linux 与 macOS、许可证。
  - nb-harness、nb-profile、nb-session、nb-runtime 新写简短 README：做什么、只用 Bun、公开入口、链接 Spec。
  - 已有的 nb-ui、nb-agent-ui、nb-form、nb-markdown README 补“安装”一节：npm 包名、要宿主的 Vite 与 Tailwind 编译（链接 ADR 0028）、peer 依赖；删掉与发布矛盾的说法。
  - 根 `README.md` 加一节“npm 包”，列出 9 个包。
  - `PROJECT-STATUS.md` 按实际状态补一行。

设计审查（omp，11 条，[design-review-omp.txt](evidences/design-review-omp.txt)）全部成立，已按条改进本计划，正文里标了条号。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/cli-skill.md` | 边界、命令表、`skill install` 的输出与验收、Skill 调用方式 |
| `docs/adr/0029-…md`、`docs/adr/README.md` | 新 ADR 与登记 |
| `docs/proposals/novel-story-app.md` | 追加决策记录 |
| `packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`docs/standards/repository-workflow.md` | 见上 |
| 9 个包的 README、根 README、`PROJECT-STATUS.md` | 见上 |

## 切片

1. **Spec 与 ADR**（主工作区 master）：cli-skill.md、ADR 0029、提案记录、`packages/AGENTS.md`、`monorepo-boundaries.md`。验证：`bun run docs:check`、`bun run governance:check`。
2. **包清单与清单检查**（worktree）：9 个 `package.json`、`LICENSE`、nb-story 的依赖重分、`prepack` 与 `os`、nb-ui 的版本与图标依赖，再跑 `bun install` 更新 `bun.lock`；`scripts/release/packages.ts` 与 `release:check` 放在这一片，用它核对清单。验证：`bun run release:check`；逐个 `bun pm pack` 看文件清单；`bun run test:affected`；9 个包的 `typecheck`；nb-story `build:web`。
3. **`nbstory skill install`**：命令、`SKILL.md`、命令行测试。验证：nb-story 的命令行测试与 `typecheck`。
4. **冒烟与发布脚本**：`pack-smoke.ts`、`publish.ts` 与根脚本。验证：`bun run release:smoke` 通过；`bun run release:publish` 不带 `--yes` 时跑完前置检查、在“没登录”处停下（本机 npm 没登录）；`bunx tsc --noEmit -p scripts/tsconfig.json`。
5. **README 与流程文档**：9 份 README、根 README、`repository-workflow.md`、`PROJECT-STATUS.md`。验证：`bun run docs:check`。

每片单独提交。收口跑 nb-story 全量 e2e（依赖重分会影响网页构建），然后启动实现审查，合入 master。

## 验收映射

- `story/cli-skill` 新增的 `skill install` 输出与验收场景 → nb-story 命令行测试（真实临时目录，覆盖 installed、unchanged、目录不同时退出 2、`--force` 替换、`--dir` 与 `--agent` 互斥）；`release:smoke` 再从安装好的包里跑一遍。
- ADR 0029 的“发源码、只用 Bun、Vue 包由宿主编译” → `release:smoke` 的命令行、`serve` 与 Vite 宿主三段。
- “不发不该发的文件” → `release:smoke` 的文件清单检查。
- “源码导入的包都写进了依赖” → `release:check`；“装到仓库外也能用” → `release:smoke` 在仓库外的临时项目里跑。
- 发布前的门禁、`E404` 以外的查询失败停下 → `publish.ts` 不带 `--yes` 的一次运行（本机没登录，停在登录检查）；查询失败的分类另写单测。
- “按依赖顺序发、跳过已发布的版本” → `publish.ts` 不带 `--yes` 时的输出（本 Task 不实际发布）。

## 验证

- 端到端：`bun run release:smoke` 在真实 Bun 进程里从 tarball 安装、运行命令行、起服务并用真实浏览器打开页面、构建 Vite 宿主。
- 回归：受影响包的单测与 typecheck、nb-story 全量 e2e、`docs:check`、`governance:check`、`bunx tsc --noEmit -p scripts/tsconfig.json`。
- 未验证的边界：真正的 `bun publish` 与从 registry 安装（要开发者登录 npm 后执行，之后跑 `release:smoke --from registry` 补证据）；`@notnotype` 这个 scope 是否归开发者的 npm 账号（发布时 registry 会拒绝不属于自己的 scope）；macOS（OMP 的原生模块按平台装，只在 Linux 上跑过；Windows 由 `os` 挡在安装时）；Codex 的 Skill 目录以 Codex 当前文档为准，没有在 Codex 里实际加载过。

## 不做与风险

- 不出 `.js` 与 `.d.ts`，不支持 Node。TypeScript 消费者会用自己的 tsconfig 检查这些源码，严格度不同可能报错；`skipLibCheck` 管不到 `.ts`。第一版接受，在 README 里写明。
- 不改 `exports`，不发 nb-story 依赖之外的工作区包（nb-memory、nb-history 等）。
- 不设 CI 发布，不做 changelog。
- 风险：发出去的版本号不能再用，撤回只有 72 小时的窗口。所以 `publish.ts` 缺省只列出，要 `--yes` 才发，并且由开发者执行。
