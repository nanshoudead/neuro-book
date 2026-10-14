---
schema: nbook.task/v2
taskId: t16-cli-papercuts
status: active
updated: 2026-10-14
---

# nbdev 命令行修补：产物只提交引用到的文件等六条

## 目标与范围

处理[后续清单](../../followups.md)“试用建议”里第一档的六条（开发者 2026-10-14 定，按 autonomous-delivery 推进）：

1. `artifact publish` 只提交页面引用到的文件，其余的列出来提醒；
2. 提问标记不合规时，普通输出也逐条列出；
3. `answers --wait` 接 SIGHUP；
4. `nbdev shot` 在 Lab 里找不到组件时立即失败；
5. `task new`、`work new` 加 `--no-lease`；
6. 写命令只报与本次领号有关的撞号。

合同：包内的 [命令行合同](../../../../../packages/dev-panel/docs/cli.md) 与 [文件格式](../../../../../packages/dev-panel/docs/file-formats.md)，另有 `docs/specs/ui/component-lab.md` 场景 14 加一句。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-14 经 nbdev 新建；计划已写，待 omp 计划审查。

## 下一步

计划审查，处理意见后按切片实施。
