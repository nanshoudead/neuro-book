---
标签: []
---

# 选中浮条

关系图与全书图选中一个点后，浮在图底部居中的一条（docs/specs/story/viewer.md 输出 27）：写出选中的是谁、一个“打开……”按钮，并提示“双击或按 Enter 也能打开 · 按 F 只看周边”。用户一选点就知道怎么看详情；点空白、按 Esc 或点右边的关闭按钮取消选中，浮条随之消失。

## 布局

绝对定位在图容器底部居中，圆角、面板底、边框与面板阴影；窄屏（小于 sm）隐藏中间的提示文字，只留名字、按钮和关闭。名字过长截断，不撑宽浮条。

## 数据

```typescript
defineProps<{label: string; openLabel: string}>();
defineEmits<{(event: "open"): void; (event: "clear"): void}>();
```

`label` 是选中的点的显示名，`openLabel` 是按钮文字（“打开人物卡”“看连线说明”等，由页面按点的类型给）。

## 验证入口

关系图页与全书图页（`e2e/viewer.e2e.ts` 里选点后断言浮条与按钮）。
