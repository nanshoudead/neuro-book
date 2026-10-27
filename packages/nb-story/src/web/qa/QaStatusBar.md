---
标签: []
---

# 问答页状态条

问答页对话区下方的一行，显示这个对话累积的用量（docs/specs/story/viewer.md 输出 52）：上下文（最近一次请求的提示词 token / 模型上下文窗口 · 占比）、输入、输出、缓存读与命中率、费用。整行是一个按钮，点开上下文检查器（`QaInspector`）。对话里还没有带用量的请求时整行不显示。

## 布局

一行小号字，芯片状的几项依次排开，放不下时折行；右端一个“打开侧栏”图标。费用只在有单价时显示（`¥0.31`、`$< 0.01`），没有单价不写“未知”。窗口未知时只写已用的 token，不写分母与百分比。

## 数据

```typescript
defineProps<{messages: readonly MessageView[]; contextLimit: number | null; currency: "USD" | "CNY"}>();
defineEmits<{(event: "open"): void}>();
```

数字由 `usage.ts` 的 `sessionUsage`、`contextTokensOf` 从 `messages` 算出：输入含缓存读写（同上下文用量的口径），命中率是缓存读占全部提示词。

## 验证入口

问答页（`e2e/qa.e2e.ts`：发问之后状态条出现、数字与端点回的用量一致，点开检查器）。
