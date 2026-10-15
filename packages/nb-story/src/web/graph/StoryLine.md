---
标签: ["state:local"]
---

# 故事线

全书图“按章节”（docs/specs/story/viewer.md 输出 30）：横轴是章，一行一个主要人物或事物，点是他参与的一段情节，竖线连起同一段情节里的几个人。位置全由章号与行号算出，不跑力导向；行的顺序由 `graph.storyline` 给出。悬停一个点，同一段情节在各行上的点与竖线高亮，显示章号与标题。

只在水平方向缩放：画布下方一行是横向倍数、缩放滑块与章节范围条（`ChapterRange`）；Ctrl（或 ⌘）加滚轮以鼠标所在的章为中心缩放，滚轮与拖动画布左右平移；右下角的按钮横向放大、缩小、看全部章节。行名与行距不随缩放变；章号按看着的章数自动变密。最窄看 4 章。

## 交互

- 悬停一个点：同一段情节的点与竖线高亮。点一个点发出这段情节的 id；拖动画布后的松手不算点选。
- 滚轮：Ctrl 或 ⌘ 按着时缩放，否则平移（横向滚动量优先）。页面不跟着滚。
- 范围变化只重摆点的横坐标，不重建图；画布尺寸或明暗变化时整张重画，范围保持。

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

`state:local`：Sigma 实例、悬停与看着的章节范围（换数据时收进新的章数内）。行距按画布宽高比算，铺满高度。

## 上游边界

绘制来自 Sigma 3；镜头的缩放与平移关掉，取景范围用 `setCustomBBox` 固定（Sigma 的镜头只能等比缩放）。
