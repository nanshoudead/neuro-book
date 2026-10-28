---
schema: nbook.task/v2
taskId: t37-overlay-revisions-design
status: active
updated: 2026-10-28
---

# 覆盖层与待确认修订：界面设计

## 目标与范围

在抽取出来的图之上加一层用户可审阅的修订：用户的手动修改，以及马甲核对与事后扫描提出的建议，都先进“待确认”，确认后才生效。先按 design-review 定界面（人物卡就地确认、待确认列表、编辑入口、范围），再写 Spec 与计划

合同：定稿后写 `planned` Spec（新能力“图的修订”，并改 [`story.queries`](../../../../../docs/specs/story/queries.md) 的身份连接与 [`story.viewer`](../../../../../docs/specs/story/viewer.md)）；本 Task 不改现有 Spec。依据：[t35 小抽取结果](../t35-persona-check/evidences/extract.md)、[t33](../t33-graph-issue-reports/README.md)。

草稿在 `.worktree/w00024-t37-t37-drafts`（分支 `chore/w00024-t37-t37-drafts`，不合并、不推送）：`packages/nb-story/src/web/drafts/RevisionDraft.vue`，地址 `/drafts/<场景>`，路由改动与 `shoot-drafts.ts` 都不提交。数据取自 t35 的真实抽取，完整截图集在 `.local/agent/works/w00024-nb-story/tasks/t37-overlay-revisions-design/shots/r1/`。

## 当前状态

- 2026-10-28：经 nbdev 新建。
- 2026-10-28：评审板第 1 轮（[artifacts/review/index.html](artifacts/review/index.html)，已发布 v2）：八个静态场景（人物卡就地确认、确认后、待确认页、页加抽屉、修改菜单、手动连接对话框、已处理、检查这本书）。问三题加一条规则：`confirm-place`（确认放哪，推荐两处都有）、`edit-scope`（范围，推荐身份连接加改种类、挪称呼）、`scan-product`（事后扫描进不进产品，推荐覆盖层先做、扫描另起 Task）、`rules`（不剧透：修订从依据段起生效；只改显示不改抽取数据；待确认的不生效；后文明说自动关闭；可撤销；重抽后按对象与原文位置对应）。

## 下一步

等开发者在面板上答复；答复后把决定写进本 README，再按范围写 `planned` Spec 与计划（后端：修订的数据与查询；前端：确认与编辑，要 Sonnet 审查）。
