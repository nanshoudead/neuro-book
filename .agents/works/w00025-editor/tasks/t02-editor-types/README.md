---
schema: nbook.task/v2
taskId: t02-editor-types
status: active
updated: 2026-10-15
---

# 按文件类型选编辑器：编辑器与语言贡献点、图片查看器、HTML 预览

## 目标与范围

编辑器种类与语言模式改为贡献点，按顺序为文件选编辑器；图片只看不改，HTML 可预览；Monaco 内置语言经贡献点登记，状态栏显示并可切换语言

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改）、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（加字节读取）、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)（HTTP 写请求核对来源），另新建图片查看器与 HTML 预览两份 Spec。实施计划：[plan.md](plan.md)。

## 当前状态

2026-10-14 计划经开发者确认（两个内置编辑器做成独立插件；界面不出评审稿，验收时给截图），走快速审查：Opus 与 omp 同时审计划，Opus 的结论处理完即开工，omp 的报告回来后另行处理。

## 计划审查

- Opus（`evidences/design-review-opus.txt`）：20 条，阻断 2、重要 11、建议 7。第 2–20 条成立，按建议改进计划第二版：标签改为判别联合并按“地址 + 编辑器”区分，“预览编辑器”与 preview 标签分开命名；文本与字节共用文件条目（删除、改名走同一条路）；选编辑器只看声明，并区分“未交付”和“不在了”；字节路由只服务运行中的代次，并补上上限、状态码与跨站拒绝；HTTP 端口核对 `Host`；控件合同挪进 `shared/contracts.ts`；语言按 Monaco 自己的方式一次登记，保证嵌入语言有高亮；已知二进制扩展名不读、直接说明。第 1 条（不透明源读不到模块脚本、fetch、字体）：开发者 2026-10-14 定做沙箱 iframe 加受限的读文件接口，独立源（另开端口或 `*.localhost`）搁置；落实为按令牌划分的只读预览路由，见计划第 6 节。预览默认不联网、可手动打开，是暂定，开发者还没表态。
- omp（`evidences/design-review-omp.txt`，审的是计划第一版）：19 条，阻断 1、重要 15、建议 3。与 Opus 重合的（第 2–5、7–9、11、12、15–19 条）已由计划第二版覆盖。另外几条：
  - 第 1 条（预览能读别的项目与 user 根）：第二版已改为令牌路由，`raw` 拒绝跨站请求，预览的 CSP 只放行令牌地址，不再成立；
  - 第 6 条（预览视图被公开为可写）：成立，S3 把“视图能否编辑”与“文档能否保存”分开；
  - 第 10 条（选择期间目标变了）：成立，重新打开核对标签与编辑器都没变，切换语言在 S6 同样处理；
  - 第 13 条（开发模式下 Vite 有带副作用的 GET）：默认 CSP 挡住；打开“允许联网”后挡不住，写进 html-preview 的已知限制；
  - 第 14 条（ETag 认不出同样大小、改回修改时间的改写）：成立，`5577e5c07` 改为带 inode 与 ctime，补了测试。

## 进展

- S0 Spec：`a0a85d7ba`。
- S1 字节路由与 HTTP 来源核对：`44a604d70`，ETag 修正 `5577e5c07`。
- S2 编辑器贡献点、选择顺序、标签按地址加编辑器、重新打开的选择、公开控件合同：`ba2e72ed7`。
- S3 文本与字节共用文件条目、字节标签、视图能否输入与文档能否保存分开、编辑器状态条目：`aa92afad6`。
- S4 图片查看器：`aaf3efda4`。
- S5 HTML 预览（沙箱 iframe、令牌服务与预览路由、默认不联网的 CSP、打开预览与在侧边打开预览）：`7db40c889`。实施中发现内置命令的 id 第二段必须是登记过的功能域（`nbook.<域>.<动作>`），插件 id 不算域，“允许联网”改为 `nbook.editor.toggle-preview-network`。
- S6 语言贡献点、生成的 Monaco 语言表（89 门）、语言条目与“更改语言模式”：`3518cd232`。
- S7 Spec 去掉 planned 标记、补实现合同与证据（图片查看器与 HTML 预览两份 Spec 待晋升）；预览 e2e 补字体与切走、刷新后令牌作废；预览申请失败按种类说明：`13bedd9af`。
- 验证（2026-10-15，`13bedd9af`）：`bun run test:affected --typecheck` 全部通过（Bun 1183、组件 209）；生产构建上 `e2e/editor-types.e2e.ts` 3 例、`editor-area`、`lab-editor`、`welcome`、`bookshelf-stats`、`workbench-titlebar` 共 30 例通过；`lab:shot` 图片查看器与 HTML 预览各场景在 390×800、1400×900、亮暗两种配色下 28 张无溢出（截图在本地 `.local/agent/works/w00025-editor/tasks/t02-editor-types/shots/s7/`）；`docs:check`、`governance:check` 无新增问题。

## 下一步

实现审查（快速）：前端 Sonnet、后端与领域 Opus 与 omp 同审 `0e0126753..13bedd9af`，报告在本地 `.local/agent/works/w00025-editor/tasks/t02-editor-types/reports/impl-review/`；Opus 与 Sonnet 的结论处理完即交付，omp 的报告回来后另行处理。
