---
标签: ["state:inject"]
---

# ProcList

“在跑”页的第一块（t14）：经 `nbdev dev start` 起的服务。每行写状态（启动中、在跑、没人监管、已结束）、checkout（链到 checkout 页的那一行）、package、script、地址（http 与 https 才给链接，新标签页打开）、谁起的（会话写“标题 + 短键”：标题可截断，短键次要色、不截断，t17）、起了多久、是哪个 Task 的、原因与日志路径。已结束的淡化显示。只读：停服务用命令行 `nbdev dev stop`，这里没有按钮。

## 数据

```ts
interface ProcListProps {
    /** `/api/runs` 的 `procs`；必填 */
    runs: ProcRunView[];
}
```

```ts
interface ProcListEmits {
    /** 点了 checkout 的 key（普通左键）：去 checkout 页并对准那一行，`/live/checkouts?focus=<key>`（t15 阶段 4 第 4 批）；带修饰键的点击交给浏览器 */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。空数组时写“没有经 nbdev 起的服务”。日志只显示路径，不提供下载。

## 隐藏通道理由

`state:inject`：会话标题（`sessionTitles`，t17）由页面用 `host/session-titles.ts` 的 `provideSessionTitles` 提供，这里用 `useSessionTitles` 取。标题只是给“谁”加一个好认的名字，经过的每一层零件都多一个 prop 只为往下传一张表，不值得；没有页面提供时按空表处理，只显示短键，和没有标题时一样，所以单独挂载照样能渲染。
