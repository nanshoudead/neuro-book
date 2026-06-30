# Release Notes

本文件用于记录任务完成后的 release note。每次任务更新后，可以在 `Unreleased` 下方追加用户可读的变更摘要，方便后续整理版本发布说明。

## Unreleased

## 0.5.0-canary - 2026-06-30

本次 canary 是写作模式 v1 的一次 minor 版本收口，重点是把 Plot、World Engine、Agent profile 编译、Agent 工具交互和 llmlint 工具链推进到新的稳定基线。

- 写作主路径：Plot 入口回到普通写作界面，Plot System 收敛为 Scene-only 模型；Scene 通过时间范围、地点 subject 和出场 subject 连接 World Engine，旧 `StoryPlot / Plot Beat` 退出正式模型。
- Plot / World Engine 桥接：Scene 可查询对应 World Engine slices 和 subject states；Plot Workbench 增加 World Engine 连接编辑、Subject 选择器和上下文面板，Agent 可通过 `get_chapter_writer_brief` 取得章节写作 brief。
- Agent profile 编译系统：`.compiled` 改为内容寻址 artifact + 原子 manifest，runtime 严格拒绝 stale / failed profile；设置页改用专用 settings / build-status 接口展示编译状态，减少 editor snapshot 热路径负担。
- Agent 工具交互：`request_user_input` 从 Low-Code Form 拆出，成为专用问答协议；`read` / `edit` / approval / Plan Mode 等工具恢复链路补齐 durable pending、行号定位和预检诊断。
- llmlint：默认规则集改为 `rules/` 目录递归加载，内置规则扩展到稿件级检测；CLI 支持多文件 / 目录扫描、Markdown 结构遮罩和 `fix` 自动修复零宽字符、重复标点等机械痕迹。
- llmlint 发布准备：在 `.agent/workspace/llmlint` 准备独立 GitHub-only Bun CLI + Agent Skill 发布骨架，neuro-book 继续保留 vendored runtime snapshot。
- llmlint eval harness：完成评测体系设计，明确 reference / brief / rendition / plot group 等术语，采用 AI vs 人类配对 lift、检测器 AUC 和模型“最像人类”排名作为规则治理指标。
- Profile MCP Config：完成第一版架构设计，推荐 Workspace Root MCP server registry + profile tool allowlist + frozen run tool snapshot；MCP 不进入 profile 编译热路径。
- 文档与参考：`PROJECT-STATUS.md`、`reference/plot`、`reference/world-engine`、`reference/agent` 和相关 task walkthrough 已同步当前产品合同。

验证记录来自对应 tasks：Task 78 completion audit 覆盖 Plot / brief / profile contract；Task 79 覆盖 profile 编译系统并发、发布与隔离；Task 77 / 51 覆盖 llmlint rule registry、CLI、user-assets 同步与 typecheck；Task 18 / 63 覆盖 Agent runtime hooks、user input、approval、file tools 和 session 恢复链路。本次提交流程不额外进行浏览器验证。
