---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-24
superseded-by: null
---

# ADR 0029：nb-story 与它依赖的 8 个工作区包以源码发布到 npm，只承诺 Bun

- 日期：2026-10-24
- 决策者：开发者
- 关联工作：[w00024 t17](../../.agents/works/w00024-nb-story/tasks/t17-npm-release/README.md)
- 相关文档：[`story.cli`](../specs/story/cli-skill.md)、[ADR 0028](0028-tailwind-only-host-compiles-nb-ui.md)、[`docs/standards/repository-workflow.md`](../standards/repository-workflow.md#发布授权)

## 背景

nb-story 第一版只从仓库运行（[提案](../proposals/novel-story-app.md)）。开发者 2026-10-24 定把它发布出去，让不克隆仓库的人也能装上 `nbstory`、用网页与 Skill。

nb-story 依赖 8 个工作区包：nb-ui、nb-agent-ui、nb-form、nb-markdown、nb-harness、nb-profile、nb-session、nb-runtime。它们都是 `private`，内部依赖写 `workspace:*`，`exports` 直接指向 `.ts` 与 `.vue` 源码，没有构建产物。仓库里的消费者（新应用、nb-story、dev-panel）都由 Bun 直接执行 TypeScript，或由宿主的 Vite 与 Tailwind 编译这些源码（ADR 0028）。

## 决策

1. 这 9 个包都以 `@notnotype/<包名>` 发布到 npm，许可证与仓库相同（AGPL-3.0-only），每个包带一份与仓库根相同的 `LICENSE`。不打成一个包：库包可以单独被别的宿主使用。
2. 发布源码，不出 `.js` 与 `.d.ts`。运行时只承诺 Bun；Vue 包由宿主的 Vite 与 Tailwind v4 编译，与仓库里一样，并把 `vue` 与 `typescript` 写成 peer 依赖（Vue 的单文件组件编译器解析导入的 props 类型要用 TypeScript）。`engines` 写 Bun 的最低版本；nb-story 另写 `os: ["linux", "darwin"]`。
3. `files` 用白名单，不发测试、夹具、Agent 规则与开发配置。包里源码值导入的第三方包（包括 CSS 的 `@import`、`@plugin`）必须写进该包自己的 dependencies 或 peerDependencies，不靠仓库根的提升。nb-story 的网页在打包前用 Vite 构建进包里，只给网页用的包放 devDependencies。
4. 内部依赖写 `workspace:^`，`bun publish` 发布时改写成 `^<版本>`。不用 `npm publish`：它不认 `workspace:`。
5. 版本手工管理。首发 nb-ui `0.2.0`，其余 `0.1.0`，都发到 `latest`。仓库根的 `release:publish` 按依赖顺序发布，跳过已发布的版本；发布前跑清单检查、类型检查与从打好的包安装的冒烟。发布由开发者执行（远端写入要授权）。
6. 不包括新应用 `packages/neuro-book` 的交付链：打包、安装、桌面版仍按 [`monorepo-boundaries.md`](../modules/monorepo-boundaries.md) 另行设计。其它工作区包需要发布时另作决定。

## 备选方案

- **只发 nb-story 一个包，把内部包打进去**：用户装起来最简单，但库包不能被别的宿主使用。开发者选了 9 个包都发。
- **每个包出一份构建产物**：Node 也能用、消费者不必编译，但 9 个包都要配构建与类型产物，仓库里仍用源码，两套会分叉。只承诺 Bun 时收益不抵成本。
- **changesets 管版本**：一个维护者、9 个包，每次改动写变更文件的收益小；它的 `changeset publish` 走 `npm publish`，不改写 `workspace:`。

## 后果

- 用户要先装 Bun。Windows 上装不上 nb-story；其余 8 个包不限平台（nb-harness 依赖的 OMP 原生模块按平台装）。
- TypeScript 消费者用自己的 tsconfig 检查这些源码，严格度不同时可能报错；`skipLibCheck` 管不到 `.ts`。
- 只改一个底层包时，可以只发它和确实要用新版本的包；上层包的 `^` 范围会接受同一 0.x 小版本里的新补丁。
- 发出去的版本号不能再用，撤回只有 72 小时的窗口；`release:publish` 缺省只列出要发的包，要 `--yes` 才发。
