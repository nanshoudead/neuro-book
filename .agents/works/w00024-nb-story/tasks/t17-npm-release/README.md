---
schema: nbook.task/v2
taskId: t17-npm-release
status: active
updated: 2026-10-24
---

# nb-story 与它依赖的 8 个包发布到 npm

## 目标与范围

nb-story 连同 8 个内部依赖包（nb-ui、nb-agent-ui、nb-form、nb-markdown、nb-harness、nb-profile、nb-session、nb-runtime）作为 npm 包发布，只用 Bun 运行；加 `nbstory skill install`；更新文档与 README。最后一步 `publish` 由开发者执行。

合同：会改 [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（不再“只从仓库运行”、新增 `skill install`）；新增一份 ADR（工作区包的发布形态，`packages/AGENTS.md` 要求公开包名、版本、exports 与发布合同先记为跨 Module 决策）；[nb-story 提案](../../../../../docs/proposals/novel-story-app.md) 追加决策记录。

计划：[plan.md](plan.md)。

## 决定

开发者 2026-10-24 在会话里定：

1. 发布前不做真实模型冒烟。
2. t16 待确认的 7 条全部追认。
3. 整个 monorepo 照旧是 AGPL-3.0-only，发布的包也是。
4. 只支持 Bun 运行。
5. 9 个包都发布（不打成一个包）。
6. 加 `nbstory skill install`。
7. 文档与 README 要更新。

## 当前状态

- 2026-10-24 计划写好（[plan.md](plan.md)）。
- 2026-10-24 设计审查：omp 一份，11 条（阻断 2、重要 8、建议 1，[design-review-omp.txt](evidences/design-review-omp.txt)），全部成立，已改进计划：
  - nb-story 两个 `.profile.tsx` 直接导入 nb-profile，留在运行时依赖；发布检查加“源码导入的包都写进依赖”的扫描。
  - nb-ui 的 `tailwind.css` 要 `@iconify/tailwind4` 与 `@iconify-json/lucide`，移进 dependencies；冒烟在仓库外的临时项目里装。
  - nb-story 的书库锁只有 Linux 与 macOS，`package.json` 写 `os`。
  - 仓库没有 `scripts:typecheck`，改用 `bunx tsc -p scripts/tsconfig.json`，新入口加进 include。
  - `release:publish` 加前置门禁（工作树干净、在 master、清单检查、typecheck、冒烟）、登录检查、只把 `E404` 当“没发布”、转交 `--otp` 与 `--auth-type`。
  - `skill install --force` 改成临时目录加改名替换，符号链接与普通文件拒绝；错误码与输出写进 Spec。
  - nb-ui 首发版本改成 `0.2.0`，不用 `alpha` tag。
  - 冒烟用真实浏览器打开页面；加 `--from registry`，发布后补一次。
  - 另按 Codex 文档（2026-10-24 查）把 `--agent codex` 的目录改成 `$HOME/.agents/skills`。

- 2026-10-24 实施（worktree `.worktree/w00024-t17`，分支 `feat/w00024-t17-npm-release`）：
  - 切片 1（master）：`df9cf3d15` ADR 0029、`story.cli` 加 `skill install` 与安装包边界、提案决策记录、模块边界；`c2036efd0` 发布步骤（`repository-workflow.md` 的“npm 包”）、ADR 补 Vue 包的 `typescript` peer、`PROJECT-STATUS.md`。
  - 切片 2：`c2200ea50` 9 个包的清单（license、repository、publishConfig、engines、`files` 白名单、`workspace:^`、各带 LICENSE），nb-story 依赖重分、`prepack` 与 `os`，nb-ui 0.2.0（`NB_UI_VERSION` 同步）与图标依赖；`scripts/release/packages.ts`（`release:check`）扫描发布文件的值导入。变异检查：去掉 nb-story 的 nb-profile、把 nb-ui 的 `@iconify/tailwind4` 挪回 devDependencies，检查都报出。
  - 切片 3：`5c5d4ce2e` `nbstory skill install` 与测试（6 条，真实临时目录），`SKILL.md` 改用装好的 `nbstory`。
  - 切片 4：`c2af714a3` `release:smoke`（打包、仓库外安装、命令行、`serve` 加真实浏览器、Vite 宿主构建）与 `release:publish`（门禁、登录、`E404`、`--yes`）。冒烟第一次跑出真问题：Vue 宿主构建时单文件组件编译器要 `typescript` 解析导入的 props 类型，4 个 Vue 包加了 `typescript` peer 后通过。
  - 切片 5：`689ff3a1e` 9 份 README、根 README 的“npm 包”、`release:check` 查 README。
  - 验证：9 个包 typecheck、`bunx tsc -p scripts/tsconfig.json`、`scripts/release` 9 条测试、nb-story 单测 458 条、nb-ui 565 条、`release:check`、`release:smoke` 全部通过；`docs:check` 无失败。`release:publish` 在 worktree 上停在“会发布的目录有未提交的改动”（当时确实有），门禁生效。
  - `test:affected` 另报 llmlint（24 个测试文件转译失败）与 neuro-book-test-support（`paths.test.ts` 一条）失败；master 上同样失败，不是本 Task 引起的。

## 下一步

1. nb-story 全量 e2e，然后启动实现审查（omp），处理后合入 master。
2. 开发者发布：`npm login`，`bun run release:publish`，确认后带 `--yes`；发布后 `bun run release:smoke --from registry` 补证据。
