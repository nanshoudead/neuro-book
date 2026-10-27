---
标签: [state:local, env:portal]
---

# 上下文检查器

点状态条（`QaStatusBar`）打开的右侧抽屉（nb-ui `Drawer`，docs/specs/story/viewer.md 输出 52）：这个对话的上下文占用、累积用量，以及逐次请求的缓存条。数据只用对话里已有的助手消息用量，不向服务端另取。

## 布局

标题“上下文与缓存”，三段：

1. **上下文**：最近一次请求的提示词 token、窗口大小与占比，下面一根进度条（占比不到 100 时按比例，超过封顶）；窗口未知时只写 token。
2. **累积**：请求次数、输入、缓存读、缓存写、输出、命中率、费用（没有单价时不出费用）。
3. **每次请求的缓存**：一行一次请求：序号、一根三色条（绿=缓存读、黄=缓存写、灰=新输入，合计 100%）、命中率，下一行写“提示词 → 输出”token 与这次的费用。

## 数据

```typescript
defineProps<{open: boolean; messages: readonly MessageView[]; contextLimit: number | null; currency: "USD" | "CNY"}>();
defineEmits<{(event: "update:open", value: boolean): void}>();
```

没有做：上下文构成（系统提示词、工具、历史各占多少）、缓存保留方式、缓存失效诊断——问答记录不记这些分项（见 t24 的说明）。

## 验证入口

问答页（`e2e/qa.e2e.ts`）。
