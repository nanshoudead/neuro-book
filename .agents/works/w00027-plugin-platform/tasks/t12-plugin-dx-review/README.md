---
schema: nbook.task/v2
taskId: t12-plugin-dx-review
status: active
updated: 2026-10-24
---

# 插件开发体验与可维护性复查，及待确认的三项改判

## 目标与范围

开发者 2026-10-24 要求：派一个 Sonnet 子代理以第三方作者身份完整走一遍插件开发，评价当前 API 形状；另派一个 Sonnet 子代理审查插件平台（t03–t05）的编码规范、设计与可维护性。两份报告的结论与待确认清单里改判的三项（typebox 进宿主模块表、provide 改名、第三方视图排在内置之后）一起在本 Task 处理。

合同：本 Task 只做复查与一处小改（第三方视图的缺省排序，[workbench-shell](../../../../../docs/specs/ui/workbench-shell.md) 的视图排序规则补一句）；其余改动的合同见 t13 与之后的作者 API Task。

## 当前状态

2026-10-24 两份复查完成，报告存为证据：

- [作者体验](evidences/dx-sonnet.txt)：Sonnet 以作者身份从零写“每日字数目标”插件，全部走通，约 30 分钟；阻断 0、重要 9、建议 11。
- [可维护性](evidences/maintainability-sonnet.txt)：阻断 0、重要 6、建议 14。

处理去向（开发者 2026-10-24 在会话中定方向）：

- 分层与可维护性的结论并入 [t13](../t13-sdk-package-split/README.md)：内核去掉 NeuroBook 常量、通用插件管理单独成目录、公开入口收窄、作者材料归拢；逐条对应见 t13 的 design.md 与 plan.md 第 9 节。
- 作者 API 形状的结论（结果助手、贡献助手、短名、缺省值、出错可见等）整理为 t13 design.md 第 4 节的 A1 到 A9，开发者确认后单独建 Task。
- 待确认清单改判的三项：typebox 进宿主模块表并入 t13 的 S3；`provide` 改名并入作者 API（A6）；第三方视图排在内置之后留在本 Task 做。

## 下一步

改第三方视图的缺省排序（没写 `order` 的第三方视图排在内置视图之后），补测试后合入，本 Task 完成。
