---
标签: ["state:local"]
---

# 故事线

全书图“按章节”（docs/specs/story/viewer.md 输出 30）：横轴是章，一行一个主要人物或事物，点是他参与的一段情节，竖线连起同一段情节里的几个人。位置全由章号与行号算出，不跑力导向；行的顺序由 `graph.storyline` 给出。悬停一个点，同一段情节在各行上的点与竖线高亮，显示章号与标题。

## 数据

```ts
defineProps<{
    /** graph.storyline 的结果：行（按顺序）与每段情节在各行上的点。必填。 */
    storyline: {lanes: {id: string; label: string}[]; dots: {episode: string; title: string; chapter: number; lane: string}[]};
    /** 横轴画到第几章（阅读位置所在章）。必填。 */
    chapters: number;
}>();
defineEmits<{(event: "select", episode: string): void}>();
```

没有 slots、expose；attrs 透传。

## 状态

`state:local`：Sigma 实例与悬停。行距按画布宽高比算，铺满高度；尺寸变化时重设画布。

## 上游边界

绘制与相机来自 Sigma 3。
