---
schema: nbook.task/v2
taskId: t06-e2e-baseline-failures
status: done
updated: 2026-10-20
---

# 修 master 上一直失败的三条 e2e

## 目标与范围

lab-markdown 场景 1、workbench-shell 拖动边界、workbench-views 拖到零后刷新三条 e2e 在 master 上稳定失败（t03 验证时发现），查明原因并修好

合同：行为合同未变。工作台修复让实现回到 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 原有的表现；测试修复对齐 [`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md) 输出 6 与验收场景 1。

## 当前状态

执行位置：worktree `.worktree/w00029-t06-e2e`，分支 `fix/w00029-t06-e2e-baseline`（从 master 拉出），已合入 master（合并提交 `fe4302f6a`，未推送），worktree 与分支已删。

- **工作台两条（`90e4a20c6`）是产品缺陷**：二分查找定位到 `cc36f626c`（10-14，页面自己加载外壳）。那次之后布局 store 要等外壳代码下载完、渲染时才创建，记录在外壳挂上之后才开始读：每次打开都先按缺省布局画出来，记录到了侧栏、面板再从缺省尺寸动画收起（刷新后采样看到 7 个动画在跑），缺省可见的视图也被加载。改为开始加载外壳时就创建 store，读记录与下载外壳代码并行。
- **`lab-markdown` 场景 1（`9a6b12af6`）是测试的时机问题**：二分查找的结果互相矛盾（指向只改文档的提交），说明它时好时坏；CPU 降速 3 倍下 4 次失败 3 次。提示块自己还在追加时按输出 6 本来就会被替换，测试却在它第一次出现时就记下元素。改为等它后面一块出现再记。

验证：工作台相关 e2e 七个文件 91 例通过；`lab-markdown` 正常速度连跑 3 遍、降速 3 倍连跑 4 遍都过；变异检查（展示器每次替换全部块）这条失败；neuro-book 类型检查、工作台 Bun 233 例与 vitest 64 例通过；`docs:check` 没有失败。

## 下一步

无。
