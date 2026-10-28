---
schema: nbook.work/v1
workId: w00032-agent-integration
issueId: null
status: active
updated: 2026-10-28
---

# NeuroBook 接入 Agent

## 目标

Agent 作为内置插件接入 NeuroBook：以 master 的 nb-harness 为底座，参考内核分支 feat/w00002-harness-kernel 逐块补能力；先按先后关系逐条讨论设计，定稿后再实施。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-10-28 | 开发者：以 master 的 nb-harness（nb-story 在用的那套）为底座，参考内核分支 `feat/w00002-harness-kernel`，分支做得多的地方逐块移过来 |
| 2026-10-28 | 开发者：插件给所有 Profile 加工具时，一起考虑工具发现（t04） |
| 2026-10-28 | 开发者：先建 Task 草稿，按先后关系逐个讨论设计 |
| 2026-10-28 | t02 定稿：合同以 master 为准、代码以分支为主体；一个包子路径导出；分工按“离开 NeuroBook 还能不能用”；升最新 OMP；分支 Spec 随代码搬来（[t02](tasks/t02-harness-baseline/README.md)） |
| 2026-10-28 | t03 定稿：条目树加当前叶子；会话放状态根、不随书走；不加租约；旧格式不在读取时转换，另给一次性迁移脚本（[t03](tasks/t03-session-model/README.md)） |

## 调研

- [仓库内的现状](research/2026-10-28-repo-survey.md)：harness 两条线、新应用现状、文档冲突、其它 Work 里相关的未完成事项、旧应用的 Agent 功能面、nb-story 问答的预演。
- [外部参照](../../../docs/research/agent-runtime-references.md)：omp 与 DeepSeek Harness 的机制、模型接口与 OMP 包族的工具发现。
- [需求对照与遗漏](tasks/t01-survey/artifacts/report/index.html)（t01 的 `report` 产物）：开发者列的 20 条需求与清单外 10 项。

## 讨论顺序

| Task | 讨论什么 | 前置 |
|---|---|---|
| [t02](tasks/t02-harness-baseline/README.md) | harness 底座：两条线对照与移植清单 | — |
| [t03](tasks/t03-session-model/README.md) | 会话模型：条目树、回退与分支、存放与单写者 | t02 |
| [t04](tasks/t04-tool-registry/README.md) | 工具登记、命名与工具发现 | t02 |
| [t05](tasks/t05-profile/README.md) | Profile：定义、存放层次、钩子与设置 | t02、t04 |
| [t06](tasks/t06-approval/README.md) | 审批、提问与 Agent 模式 | t03、t04 |
| [t07](tasks/t07-run-control/README.md) | 运行控制：插话、排队与中止 | t03、t06 |
| [t08](tasks/t08-resources-home/README.md) | 资源地址与 home：会话、Profile、Agent 三层与文档 | t03、t05 |
| [t09](tasks/t09-models/README.md) | 模型服务与模型角色 | t02 |
| [t10](tasks/t10-agent-plugin/README.md) | Agent 插件骨架与贡献点 | t02 到 t09 |
| [t11](tasks/t11-compaction/README.md) | 上下文压缩 | t03、t09 |
| [t12](tasks/t12-builtin-tools/README.md) | 基础工具与外部命令行依赖 | t04、t06、t08 |
| [t13](tasks/t13-history/README.md) | nb-history 接入与文件变更感知 | t08、t12 |
| [t14](tasks/t14-multi-agent/README.md) | 多 Agent 与 Workflow | t05、t06、t07 |
| [t15](tasks/t15-skills/README.md) | Skill 规范与目录 | t05、t08、t10 |
| [t16](tasks/t16-command-bridge/README.md) | Agent 操控 NeuroBook 与 `nbook project` 子命令 | t06、t10 |
| [t17](tasks/t17-conversation-ui/README.md) | 对话界面：Composer、状态栏、待处理区（并入 w00019 t11） | t06、t07、t09、t10；w00028 t03 合入 |
| [t18](tasks/t18-builtin-profiles/README.md) | 内置 Profile、提示词规范与评测 | t05、t12、t15 |
| [t19](tasks/t19-mcp/README.md) | MCP 插件 | t04、t08、t10 |

讨论顺序就是依赖顺序；讨论定的事写进各 Task 的 README，实施的切片与分支在讨论完后另定。

## 相关 Work

- [w00002](../w00002-neuro-agent-harness-redesign/README.md)：nb-harness 的来历；内核分支的记录只在分支上（主工作区那份 README 停在 2026-09-22）。
- [w00019 t11](../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)：对话视图完整版，并入 t17。
- [w00025 t12](../w00025-editor/tasks/t12-inline-ai-editor-api/README.md)：行内 AI 编辑器接口，在本 Work 要在编辑器里改正文时开工。
- [w00028 t03](../w00028-i18n/tasks/t03-shared-packages-migration/README.md)：共享包的文字迁移，合入后再写 Agent 插件的界面。
- [w00031 t03](../w00031-language-policy/tasks/t03-failure-projection/README.md)：错误码与参数，工具错误的形状按它来。
- [w00024](../w00024-nb-story/README.md)：nb-story 问答是 nb-harness 现在唯一的使用方。
