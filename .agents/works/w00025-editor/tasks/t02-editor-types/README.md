---
schema: nbook.task/v2
taskId: t02-editor-types
status: active
updated: 2026-10-14
---

# 按文件类型选编辑器：编辑器与语言贡献点、图片查看器、HTML 预览

## 目标与范围

编辑器种类与语言模式改为贡献点，按顺序为文件选编辑器；图片只看不改，HTML 可预览；Monaco 内置语言经贡献点登记，状态栏显示并可切换语言

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改）、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（加字节读取）、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)（HTTP 写请求核对来源），另新建图片查看器与 HTML 预览两份 Spec。实施计划：[plan.md](plan.md)。

## 当前状态

2026-10-14 计划经开发者确认（两个内置编辑器做成独立插件；界面不出评审稿，验收时给截图），走快速审查：Opus 与 omp 同时审计划，Opus 的结论处理完即开工，omp 的报告回来后另行处理。

## 计划审查

- Opus（`evidences/design-review-opus.txt`）：20 条，阻断 2、重要 11、建议 7。第 2–20 条成立，按建议改进计划第二版：标签改为判别联合并按“地址 + 编辑器”区分，“预览编辑器”与 preview 标签分开命名；文本与字节共用文件条目（删除、改名走同一条路）；选编辑器只看声明，并区分“未交付”和“不在了”；字节路由只服务运行中的代次，并补上上限、状态码与跨站拒绝；HTTP 端口核对 `Host`；控件合同挪进 `shared/contracts.ts`；语言按 Monaco 自己的方式一次登记，保证嵌入语言有高亮；已知二进制扩展名不读、直接说明。第 1 条（不透明源读不到模块脚本、fetch、字体）要开发者定预览的源，见计划第 6 节。
- omp：后台运行中，报告回来后另行处理。

## 下一步

开发者定预览的源（计划第 6 节 A 或 B）后从 S0 开始；不依赖它的 S1–S4 先做。
