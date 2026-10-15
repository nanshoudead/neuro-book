---
标签: []
---

# 章节范围条

全书图“按章节”画布下方的一条（docs/specs/story/viewer.md 输出 30）：整条代表第 1 章到阅读位置所在章，高亮的一段是图上正看着的章节范围，右边写“第 a 到 b 章”。拖高亮段整体平移；拖它的左右两端只改起点或终点。范围不越出全书，宽度不小于 `minSpan` 章。

## 布局

一行：左端章号 1、轨道、右端最后一章的章号、范围文字。轨道 14 像素高，浅底；高亮段用强调色描边和淡底，两端各有 6 像素宽的拖动区（光标变成左右箭头）。

## 交互

- 指针按下高亮段并拖动：平移。按下两端：改一端。拖动中每次移动都发出新范围，松手后结束监听。
- 不处理键盘与滚轮；滚轮缩放与平移由画布处理（见 StoryLine）。

## 数据

```ts
type ChapterWindow = {start: number; end: number}; // 章的连续坐标：第 c 章占 [c - 0.5, c + 0.5]
defineProps<{
    /** 当前看着的范围。受控。必填。 */
    range: ChapterWindow;
    /** 章数（阅读位置所在章）。必填。 */
    chapters: number;
    /** 最窄能看几章。必填。 */
    minSpan: number;
}>();
defineEmits<{
    /** 拖动时发出新范围。 */
    "update:range": [ChapterWindow];
}>();
```

没有 slots、expose；attrs 透传到根元素。
