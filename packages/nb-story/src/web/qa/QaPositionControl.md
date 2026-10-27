---
标签: [state:local]
---

# 对话的阅读位置控件

问答页对话顶部的一个按钮“读到 第 N 章”（docs/specs/story/viewer.md 输出 53）：点开选一个章、点“确定”改这个对话下一问用的阅读位置。已有的对话立刻写进会话（页面调 `qa.position`，随后在对话里出现一条可展开的系统提醒）；新对话还没有会话，改的是第一问的位置。

## 布局

一个小号的圆角按钮，图标加位置文字加下拉箭头；点开是一个小气泡：一个章选择（第 1 章到已抽取的最后一章）与“取消”“确定”。选的章与现在的相同时“确定”停用。按钮在不能改时停用，悬停写原因（对话在运行、全读对话的位置不能改、会话日志读不成不能续问）。

## 数据

```typescript
defineProps<{at: {chapter: number; paragraph?: number}; paragraphs: readonly number[]; maxChapter: number; disabledReason: string | null; busy: boolean}>();
defineEmits<{(event: "change", chapter: number): void}>();
```

`at` 是现在的位置，`paragraphs` 是各章的段数（停在一章最后一段的写“第 N 章”，否则写“N.M”）；`maxChapter` 是能选到的最后一章；`disabledReason` 非空时按钮停用；`busy` 是正在改（请求在途）。

## 验证入口

问答页（`e2e/qa.e2e.ts`：改位置后对话里出现系统提醒、刷新后仍在；运行中与全读对话按钮停用）。
