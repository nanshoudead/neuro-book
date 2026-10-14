---
schema: nbook.task/v2
taskId: t17-panel-small-fixes
status: active
updated: 2026-10-14
---

# 面板小修：勾选框的根上修法、会话页终端高度、各处显示会话标题

## 目标与范围

处理[后续清单](../../followups.md)第二档（开发者 2026-10-14 定，按 autonomous-delivery 推进）：

1. nb-ui `FormCheckbox` 的 label 加 `relative`，并用 nb-ui 的 Playwright 验收钉住；
2. 1440×650 这类矮窗口下，会话页的终端偏矮；
3. 首页、Task 页、运行页等显示租约的地方带上会话标题。

合同：[面板](../../../../../packages/dev-panel/docs/panel.md)、`packages/nb-ui/src/components/form/FormCheckbox.md`。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-14 实施完成，在集成分支 `feat/w00022-dev-panel` 上，未合入 `master`：

| 片 | 提交 | 内容 |
|---|---|---|
| S1 | `43a1090c7`、`8521f9c83`（合并 `8276c0bb2`） | nb-ui `FormCheckbox` 的 label 加 `relative`，验收夹具与 e2e（改前格子 `scrollTop` 280、改后 0）；nb-ui 的 Playwright 用本机 Chrome |
| S2 | `7c6d9ca97`、`066fceb6a` | 会话标题在活动刷新之外的后台任务里批量读（单飞、每轮 2 秒预算），进快照与指纹；首页、Work 页、Task 页、运行页显示“标题 + 短键”，核对身份的句子保留短键 |
| S3 | `d5535e531` | 会话页紧凑写法：`PageShell` 加 `compact`、会话信息一行可折行、输入框行数随内容、发送按钮并入按键行 |

- 计划与两份计划审查：[plan.md](plan.md)，[evidences/plan-review-ui.txt](evidences/plan-review-ui.txt)（Sonnet，前端），服务端一节见 t18 的 `evidences/plan-review.txt` 第 8 到 11 条与 `plan-review-2.txt` 第 6、7 条（omp）。
- 交付报告：[evidences/s1-delivery.txt](evidences/s1-delivery.txt)、[evidences/s2-s3-delivery.txt](evidences/s2-s3-delivery.txt)。
- 终端画面高度（假 herdr 起的临时面板）：1440×650 从 222 到 346，1440×900 从 472 到 596，1280×650 从 184 到 346，1100×700 从 229 到 353；截图在本地 `.local/agent/works/w00022-dev-panel/tasks/t17-panel-small-fixes/shots/`。
- 主会话自跑：dev-panel typecheck 通过、全量 445 个通过、`build:web` 成功；nb-ui 的 e2e 31 个通过。
- 已知问题：Work 页 Task 表“谁在动”一列里标题被截到只剩一两个字，随实现审查一起处理。
- 未验证：读标题很慢时活动照样及时发布（构造不出稳定的慢读取），留给实现审查核对代码；合入后在真实面板 4400 上截图。
- 实现审查待处理：前端 Sonnet 在审；服务端等 omp。

## 下一步

处理实现审查；合入 `master` 要开发者授权，合入后重启面板 4400 并在真实面板上补截图。
