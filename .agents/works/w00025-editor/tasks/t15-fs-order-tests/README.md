---
schema: nbook.task/v2
taskId: t15-fs-order-tests
status: active
updated: 2026-10-20
---

# 文件测试不依赖目录列表顺序

## 目标与范围

t14 验证时 neuro-book 的 Bun 测试有 3 例失败，master 上同样失败（2026-10-20 `/tmp` 从 tmpfs 换到 btrfs 之后）。开发者 2026-10-20 同意开小 Task 修。只改测试。

合同：行为合同未变（[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 的已有验收照旧）。

## 当前状态

执行位置：worktree `.worktree/w00025-t15-fs-order-tests`，分支 `fix/w00025-t15-fs-order-tests`，提交 `9350442e2`。三例的原因与改法：

- `files/backend/entry-ops.test.ts`“移动：目标已存在为 conflict…”：断言默认了 `readdir` 的返回顺序（btrfs 不按创建顺序）。改为排序后比较。
- `files/changes.test.ts`“一批编码后装不进一条 RPC 消息：只推 resync”：辅助函数 `writeAndSee` 只等最后一个文件的第一个原始事件，btrfs 上一次写入是创建与修改两个事件，后一个落进下一批、被当成普通变化推出。改为写完后在场景外写一个屏障文件、等测试自己的监视器看到它（全部 `fs.watch` 共用一个 inotify 实例、按发生顺序投递）。
- `settings/backend/layer-owner.test.ts`“合并：最后一次事件后静止 50 毫秒才重读”：不是负载偶发，8 次失败 7 次。实测前一个事件刚送到就原地再写同一个文件时，Bun 的 `fs.watch` 有时不给这次写入任何事件（间隔 0 毫秒十次丢四到六次，间隔 2 毫秒起不丢；/tmp 与家目录的 btrfs 都一样）。产品不受影响：重读在静止 50 毫秒之后，读到的已是这次写入的内容。测试的第二次写入改为“写临时文件再改名替换”（实测不丢）。

验证：三个文件连跑 5 次 45 例全过；`test:affected --typecheck` 全部通过（vitest 363 例）；`governance:check` 没有本次的问题。

## 下一步

已合入 master（合并提交 `feb45174a`，未推送）。
