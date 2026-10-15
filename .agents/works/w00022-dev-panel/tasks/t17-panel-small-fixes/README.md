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

2026-10-14 实施完成；2026-10-15 经开发者同意合入 `master`（合并提交 `8634c9d70`），面板 4400 已重启。各片：

| 片 | 提交 | 内容 |
|---|---|---|
| S1 | `43a1090c7`、`8521f9c83`（合并 `8276c0bb2`） | nb-ui `FormCheckbox` 的 label 加 `relative`，验收夹具与 e2e（改前格子 `scrollTop` 280、改后 0）；nb-ui 的 Playwright 用本机 Chrome |
| S2 | `7c6d9ca97`、`066fceb6a` | 会话标题在活动刷新之外的后台任务里批量读（单飞、每轮 2 秒预算），进快照与指纹；首页、Work 页、Task 页、运行页显示“标题 + 短键”，核对身份的句子保留短键 |
| S3 | `d5535e531` | 会话页紧凑写法：`PageShell` 加 `compact`、会话信息一行可折行、输入框行数随内容、发送按钮并入按键行 |

- 计划与两份计划审查：[plan.md](plan.md)，[evidences/plan-review-ui.txt](evidences/plan-review-ui.txt)（Sonnet，前端），服务端一节见 t18 的 `evidences/plan-review.txt` 第 8 到 11 条与 `plan-review-2.txt` 第 6、7 条（omp）。
- 交付报告：[evidences/s1-delivery.txt](evidences/s1-delivery.txt)、[evidences/s2-s3-delivery.txt](evidences/s2-s3-delivery.txt)。
- 终端画面高度（假 herdr 起的临时面板）：1440×650 从 222 到 346，1440×900 从 472 到 596，1280×650 从 184 到 346，1100×700 从 229 到 353；截图在本地 `.local/agent/works/w00022-dev-panel/tasks/t17-panel-small-fixes/shots/`。
- 主会话自跑：dev-panel typecheck 通过、全量 445 个通过、`build:web` 成功；nb-ui 的 e2e 31 个通过。
- 实现审查（已处理）：
  - 前端 Sonnet，报告 [evidences/impl-review-ui.txt](evidences/impl-review-ui.txt)：重要 5、建议 10。改了 11 条（`c203248fe`、`87dbfd657`，交付报告 [evidences/impl-review-ui-fix.txt](evidences/impl-review-ui-fix.txt)）：Task 表一列只显示短键、标题进提示；不能发的原因放回可见文字并用 `aria-describedby` 关联；输入框改用 `field-sizing: content`；撤掉 provide/inject，页面直接传 prop；“标题 + 短键”抽成 `SessionLabel`；手机档发送按钮回到同一行；文档对齐。不改 4 条（“确认”说明要很宽才出现、Tab 顺序、表格 chip 的停靠点、再铺一层前端自动检查），理由见交付报告。
  - 服务端 omp，报告 [evidences/impl-review-server.txt](evidences/impl-review-server.txt)：重要 3、建议 1，全部修正（`4d3c48e59`，交付报告 [evidences/impl-review-server-fix.txt](evidences/impl-review-server-fix.txt)）：冷查找的 4 个名额跨轮共享、面板停止时等标题任务收口、Codex 索引只读末尾 4 MiB（288 MB 的索引下独立客户端最长响应从 2078ms 降到 14 到 26ms）、补“只改来源”的推送用例。
- 修正后：1440×650 下空草稿时终端 345px；草稿写满 4 行时 289px，低于 320px 的目标。目标按空草稿定，写长草稿时暂时变矮可以接受，主会话判断不再压缩。dev-panel 全量 454 个通过。
- 合入后在真实面板 4400 上复核（2026-10-15，截图在本地 `shots/real_*.png`）：会话页 1440×650 下终端约 350px、1440×900 下约 600px；首页 Work 卡片、会话页列表、运行页都显示“会话标题 + 短键”。

## 下一步

无，Task 完成。
