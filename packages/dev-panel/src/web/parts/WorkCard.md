---
标签: []
---

# WorkCard

首页的一张 Work 卡片（t03 第三轮首页 A）：状态与标题、目标、各状态 Task 的计数条、待答提问数、最近更新；来自分支的 Work 带警示条；“谁在动”放在虚线框里（临时数据），会话写“标题 + 短键”（`LeaseChip`，t17）。卡片只回答“这个 Work 在等我吗、在动吗”，Task 的明细在 Work 页。

## 数据

```ts
interface WorkCardProps {
    /** `/api/overview` 里的一个 Work；必填 */
    work: OverviewWork;
    /** 会话标题（`/api/overview` 的 `sessionTitles`，键是会话键）；必填，没有标题的会话缺项、只写短键 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}
interface WorkCardEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose；attrs 落到卡片根节点。标题是去 Work 页的真实链接（`<a href>`，地址由 `host/routes.ts` 拼），能在新标签页打开、能复制地址。

## 布局

自上而下：标题行（状态徽章、编号、标题链接）、目标（最多三行）、计数条、一行元信息（待答数、最近更新）、来自分支的警示、谁在动。卡片宽度由父网格决定，内容变多时目标先截断。390 宽时卡片占满一列。
