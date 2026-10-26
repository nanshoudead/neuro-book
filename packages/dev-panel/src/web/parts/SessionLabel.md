---
标签: []
---

# SessionLabel

“谁”这一类地方的会话名（t17）：标题加短键。标题在前、超过约 16rem 截断，短键在后、次要色小字、始终显示不截断；没有标题时只写短键。标题不唯一（`--resume`、fork 沿用同一个标题），两个同名会话靠短键区分。`LeaseChip`、“在跑”页各会话的小标题与 `ProcList` 的“谁起的”都用它，截断与看全文的规则只在这一处。

## 布局

行内的弹性盒，最宽 100%，按基线对齐；字号、字重、颜色从父级继承，短键另用 `nbdev-caption nbdev-secondary`（字重恢复正常）。父级给的宽度不够时标题先收窄，短键不让位。

## 交互

- `fullText` 为真（缺省）时标题用 `TruncatedText`（不可复制）：被截断时可以用 Tab 聚焦，悬停或聚焦看全文；没被截断时不进 Tab 顺序。
- `fullText` 为假时标题只截断，不给提示：给外层已经有提示、提示里写了全文的地方用（`LeaseChip` 的提示含完整标题与来源），免得提示套提示、Tab 停两次。

## 数据

```ts
interface SessionLabelProps {
    /** 会话的显示名（`host/format.ts` 的 `sessionName`）；必填 */
    session: SessionName;
    /** 标题被截断时自己给出全文（`TruncatedText`）；可选，默认 true。外层已有含全文的提示时传 false */
    fullText?: boolean;
}
```

没有事件、插槽与 expose；attrs 落到根节点。

## 不支持

- 不写标题来源：来源由调用方写在自己的提示里（`LeaseChip`）或单独一行（会话页）。
- 不用于“核对发给哪个会话”的句子：那里只写短键（见 docs/panel.md 的“会话的写法”）。
