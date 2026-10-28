---
schema: nbook.task/v2
taskId: t13-history
status: planned
updated: 2026-10-28
---

# nb-history 接入与文件变更感知

## 目标与范围

定 nb-history 的接入：Agent、人、外部程序写入的记账，收件箱的接受与还原，每轮告诉 Agent 文件变化，以及 History 的归属插件。

来源：需求 16（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 归属：`nbook.history`（文件底座提案）还是 `nbook.project`（平台提案 P9）。
- 记账：Agent、人、外部程序三种来源；bash 的写入。
- 收件箱的接受、还原与界面。
- 每轮告诉 Agent 文件变化（旧应用三档）与 diff 预算；会话游标。
- 与编辑器未保存修改的关系（编辑器 Spec 输出 16 已覆盖磁盘变化）。

## 材料

- `packages/nb-history/README.md`
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节 nb-history
- [文件底座提案](../../../../../docs/proposals/project-file-foundation.md)

## 前置

t08、t12。

## 讨论进展（2026-10-28，开发者定优先级不高、放到本 Work 末尾）

已定的方向：

1. 归属 `nbook.history`（以 2026-10-02 接受的文件底座提案为准：单独的内置插件，默认启用、非启动必需，订阅文件底座的变更事件记账；平台提案 P9 表格里放进 `nbook.project` 的写法较早，实施时在平台提案末尾追加决策记录说明）。项目实例入口，账本 `<项目>/.nbook/history.sqlite`，随书走。只记 `project://`。
2. 来源不只人与 Agent：nb-history 已有 `user`、`agent`（`sessionId`）、`system`（`source` 标识子系统）、`external` 四种。开发者问别的插件改文件能否记录：能，文件服务按调用方身份记来源（资源 Spec），插件自己的写入记成插件来源；建议在 nb-history 里加一种 `plugin`（`pluginId`）而不是挤进 `system`；Agent 来源再加可选的 `entryId`，让每次写入对得上会话条目（t03）。插件提供给 Agent 的工具被 Agent 调用时，来源仍是那个 Agent 会话。shell 的写入记为外部（t12 定了不补）。
3. 审查收件箱事后看、可撤回，不挡流程（批准在 t06）。旧应用已有组件可以参考迁移：`packages/neuro-book-legacy/app/components/novel-ide/history/WorkspaceHistoryInboxDialog.vue`（收件箱对话框）、`…/agent/panels/workspace-changes/AgentWorkspaceChanges.vue`（对话里的变更面板）；nb-agent-ui 已迁移待处理区的“工作区变更”一项（`changes.accept`、`changes.acceptAll`、`changes.openInbox`）与轮末的改动文件条，完整收件箱还没迁。
4. 每轮告诉 Agent 文件变化：做成 `nbook.history` 带 `file-awareness` 标签的全局钩子（t20），档位关、简要、完整沿用旧应用，Profile 声明缺省、用户在 Profile 设置里改；小 diff 内联、单文件有上限、敏感文件只说改了；游标属于会话，不跟对话路径走。
5. 回退：会话回退只回会话，文件回退只回文件，两者分开，不做三选一的对话框（开发者 2026-10-28）。文件经 nb-history 还原后，Agent 会收到“文件被还原”的消息（旧应用已有的行为，nb-history 的会话游标支持“用户还原了我的修改”的通知）。
6. Agent 读旧版本：`history://<路径>@<版本>` 只读；`builtin.history` 工具（查时间线、读旧版本；还原算写，按 t06 审批）由 `nbook.history` 经 `agent.tools` 贡献。
7. 与编辑器未保存修改：沿用编辑器 Spec 输出 16 的磁盘变化处理；不让 Agent 事先知道文件有未保存修改。

## 当前状态

方向已讨论（2026-10-28），优先级不高，排在本 Work 末尾；实施前再与开发者过一遍。

## 下一步

本 Work 其它 Task 讨论完后回到这里定稿。
