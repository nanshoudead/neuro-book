---
标签: [state:local, state:inject, env:portal]
---

# 记录等级色块

说法与情节前的小方块：1 级实心、2 级描边、3 级灰框（docs/specs/story/viewer.md 输出 56、57）。没有等级（情节没有先验）时什么也不画。

## 交互

- 给了 `explain` 时色块是按钮，点开一个 nb-ui `Popover`：第一行重复色块、等级与标记（待证实、伏笔候选），下面一句为什么是这一级，再两行“后文引用”“后文又提到”（只写有没有），结尾一行说明只看阅读位置之前的内容。打开时才取 `tier.explain`；取的时候写“正在取依据……”，出错写错误说明。文字在 `tier-words.ts`。
- 没给 `explain` 时只是带 `title` 的方块，不能点（情节列表用）。

## 数据

```ts
defineProps<{
    /** 等级；null 不画。 */
    tier: 1 | 2 | 3 | null;
    /** 合并标记；只有说法有。 */
    flag?: "unconfirmed" | "foreshadow" | null;
    /** 说法或情节的 id；给了才能点开看依据。 */
    explain?: string;
    /** 说法的类别；没有先验时依据里写它。 */
    family?: string;
}>();
```

没有 emits、slots、expose。根元素带 `data-testid="tier-badge"` 与 `data-tier`；依据面板带 `data-testid="tier-explain"`。
