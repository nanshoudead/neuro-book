---
标签: []
---

# LeaseChip

一份租约（某个会话在动某个 Task）的虚线胶囊。租约是临时数据，所以按 t03 第三轮的画法用信息色虚线：超过 2 小时没有 Task 相关操作的淡化，已失效的划掉。

会话写“标题 + 短键”（t17）：有标题时标题在前、超过约 16rem 截断，短键在后、次要色小字、不截断，两个同名会话靠短键区分；没有标题时只写短键。提示（nb-ui `Tooltip`）是调用方的 `hint` 加上完整标题与它从哪里读的（Claude Code、Codex、omp 的会话文件），两段用分号隔开；有提示时胶囊可以用 Tab 聚焦，键盘也能看到提示，没有提示时不进 Tab 顺序。

## 数据

```ts
interface LeaseChipProps {
    /** 会话的显示名（`host/format.ts` 的 `sessionName`）：标题（可为 null）、短键（标签或 Agent 加会话 id 的前几位）、标题从哪里读的；必填 */
    session: {title: string | null; short: string; source: "claude" | "codex" | "omp" | null};
    /** 在动的 Task（编号）；可选，不给时只显示会话 */
    task?: string | null;
    /** 超过 2 小时没有 Task 相关操作；可选，默认 false */
    stale?: boolean;
    /** 已失效（会话已退出、提问者已不在）；可选，默认 false */
    ended?: boolean;
    /** 悬停说明（例如最近一次操作的时刻）；可选 */
    hint?: string;
}
```

没有事件、插槽与 expose；attrs 不生效（根是 nb-ui `Tooltip`，它不转发 attrs），要改宽度就在外面包一层。
