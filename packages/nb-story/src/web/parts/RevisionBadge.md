---
标签: ["state:inject", "io:read"]
---

# 导航“待确认”的角标

待确认的数目（待确认加对不上的，按阅读位置算，与待确认页一致；0 不显示）。宽导航与手机完整导航里是数字徽标，收起的导航与手机的“更多”上是一个点（docs/specs/story/viewer.md 输出 58、61）。

## 数据

```ts
defineProps<{
    /** `badge` 数字徽标，`dot` 一个点。缺省 `badge`。 */
    variant?: "badge" | "dot";
}>();
```

没有 emits、slots、expose。

## 隐藏通道理由

- `state:inject`：经 `useBook()` 取阅读位置与数据版本（`useStoryQuery`）。
- `io:read`：取 `revisions.list` 的计数。数目要随阅读位置与写入重取，由这个组件自己按数据版本取最直接；挂在导航里的几处各取一次（取回只有计数，一条）。
