---
标签: []
---

# 记录标记

一条说法或知情记录旁边的小标签：“明说”“角色的说法”“角色认为”，推断出的再加一个“推断”（docs/specs/story/viewer.md 输出 7）。“角色的说法”与“角色认为”用提醒色，提示这不是旁白确认的事实。

## 数据

```ts
defineProps<{
    /** 查询结果里的 tags；为 null 时什么也不画（例如情节、数值这类没有标记的记录）。必填。 */
    tags: {kind: "fact" | "claim" | "belief" | null; inferred: boolean} | null;
}>();
```

没有 emits、slots、expose；attrs 透传到外层。
