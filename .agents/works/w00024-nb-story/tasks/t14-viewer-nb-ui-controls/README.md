---
schema: nbook.task/v2
taskId: t14-viewer-nb-ui-controls
status: shelved
updated: 2026-10-23
---

# 查看器的手写控件换成 nb-ui 组件

## 目标与范围

查看器里手写了 nb-ui 已有控件的几处，换成 nb-ui 组件。原是 [t13](../t13-qa-web/README.md) 的决定 5，开发者 2026-10-23 从 t13 拿出（t13 决定 17）：t13 做完后，开发者看过换前换后的效果再定做不做、做哪几处。

合同：不改行为合同（[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)），外观以截图对照为准。

## 候选

| 位置 | 现在 | 换成 | 已知的障碍（t13 网页设计审查第 6、7 条） |
|---|---|---|---|
| `src/web/shell/BookFrame.vue` 手机与平板的导航、浮动抽屉 | 手写抽屉 | nb-ui `Drawer` | — |
| `src/web/shell/SearchBox.vue` 的结果浮层 | 手写的绝对定位面板 | nb-ui `Popover` | `Popover` 打开时把焦点移进内容、要有 trigger，打字时会被抢走焦点（从代码推断）；要先给 nb-ui 加“打开不抢焦点”和锚点 |
| `SecretsPage`、`OverviewPage` 的矩阵 | `story-table` | nb-ui `Table` | 表头要放人名链接与化名、行要带 `data-secret` 与 `is-highlight`（e2e 依赖），`Table` 没有表头插槽、不给行加属性与类 |
| `LedgerPage`、`StatsPage` 的表 | `story-table` | nb-ui `Table` | 列固定的小表可以换 |
| `RecordsTable` | 吸顶分组 | — | `Table` 不支持吸顶分组 |
| `PageState`、`PagedList`、`BookShell` 的重试与加载中 | 手写按钮与转圈 | nb-ui `Button`、`Spinner` | — |

## 当前状态

2026-10-23 新建后搁置，等 t13 完成。

## 下一步

t13 完成后做一份换前换后的对照（能换的几处在草稿里换上，逐页截图），交开发者定范围。
