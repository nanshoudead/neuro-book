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

## 下一步

1. 切片 1：Spec 与 ADR（主工作区）。
2. 切片 2 到 5 在 worktree `.worktree/w00024-t17` 实施。
