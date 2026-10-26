---
标签: []
---

# 人物卡小图

人物卡“关系”页签上方的小图（docs/specs/story/viewer.md 输出 29）：这个人和关系最多的 12 个，绕着他排成一圈，关系最多的在正上方、顺时针往下；左半边的名字写在点的左边；邻居之间的线画淡、不写字；线上只写关系词。它是 StoryNetwork 的固定用法，把 `graph.relations` 的点与线换成网络图的形状。

## 数据

```ts
defineProps<{
    /** 中心人物的点 id。必填。 */
    center: string;
    /** graph.relations 的点与线。必填。 */
    nodes: readonly {id: string; label: string; kind: string; mentions: number; entities: string[]}[];
    edges: readonly {a: string; b: string; relation: {word: string | null; statements: number} | null; together: number; knows: {ab: number; ba: number} | null; identity: string | null}[];
}>();
defineEmits<{select: [id: string]}>();
```

没有 slots、expose；attrs 透传到外层。高 280 像素，宽度随容器。
