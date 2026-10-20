---
标签: []
---

# 抽取状态徽标

一本书的抽取状态：抽取中（独立服务里运行）、命令行抽取中、已停下、失败停下；抽完的不显示（docs/specs/story/viewer.md 输出 36、38）。书架、进度页共用，同一种状态在各处写法与颜色相同。运行中的带一个小圆点。

## 数据

```ts
defineProps<{
    /** 取自 `ingest.status` 的一项。必填。 */
    status: Pick<IngestStatusView, "state" | "runner" | "stopReason">;
}>();
```

没有 emits、slots、expose；根元素带 `data-testid="ingest-badge"` 与 `data-state`（`running`、`cli`、`stopped`、`failed`），attrs 透传。抽完时什么也不渲染。
