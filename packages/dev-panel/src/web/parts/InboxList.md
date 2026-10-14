---
标签: ["state:inject"]
---

# InboxList

首页最上面的收件箱：只放要开发者动手的事——还没答的必答题与撞号（Proposal 第三节：会话在等的事只认登记成提问的，不从终端推断）。

**提问按产物合并**（t15 阶段 4 第 1 批，开发者 10-13：一个产物出几道题时注意力被分散）：同一个产物的待答题合成一行，写产物标题（没有标题写产物 id）与“必答 N”（收件箱只收必答题；产物页的“待答”也把必答单独数出来，两边对得上），下面列前三道题的题目、其余写“等 N 道”，再写在哪个 Work、Task 里与提问的会话（`LeaseChip`，写“标题 + 短键”，t17；去重；提问者的租约已经失效时标出来：问的会话已经不在，答了要等别的会话来采纳）。答题在产物页，一行就是去那个产物页的入口。合并在 `host/inbox.ts` 的 `groupInbox`，顺序按服务端给的、取每个产物第一次出现的位置。

**撞号写明原因与去处**（t15 阶段 4 第 2 批，开发者 10-14：看不到原因）：一条一行，写哪几个名字用了同一个号、各在哪里（主工作区、哪个 worktree、哪个 ref 上已提交），只在改名或删除后留下的旧副本里的标出来；“正在发生”（至少两个名字不是旧副本）另给徽标；最后是“怎么处理”，链到 `.agents/works/README.md` 的处理办法（文档页）。

## 数据

```ts
type InboxQuestion = {kind: "question"; workId: string; taskId: string; artifactId: string; artifactTitle: string | null; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null; askerActive: boolean | null};
type InboxConflict = {kind: "number_conflict"; label: string; live: boolean; ids: Array<{id: string; live: boolean; locations: ConflictLocation[]}>};
interface InboxListProps {
    /** 收件箱条目；必填，空数组时显示空态 */
    items: Array<InboxQuestion | InboxConflict>;
}
interface InboxListEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。每个产物一行，是去产物页的真实链接（`<a href>`），能在新标签页打开。撞号那一行本身不是链接，“怎么处理”是去文档页的真实链接（`ActionLink`）。

## 隐藏通道理由

`state:inject`：会话标题（`sessionTitles`，t17）由页面用 `host/session-titles.ts` 的 `provideSessionTitles` 提供，这里用 `useSessionTitles` 取。标题只是给“谁”加一个好认的名字，经过的每一层零件都多一个 prop 只为往下传一张表，不值得；没有页面提供时按空表处理，只显示短键，和没有标题时一样，所以单独挂载照样能渲染。
