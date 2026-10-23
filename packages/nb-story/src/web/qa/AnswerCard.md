---
标签: ["state:inject"]
---

# 答案卡片

问答 Agent 用 `answer` 交卷的那一次，在对话视图里画成的结果节点（docs/specs/story/viewer.md 的问答页，w00024 t13 决定 8、15、16）。由 `tools.ts` 的 `storyToolsContribution(AnswerCard)` 登记，不单独挂。

常显：结论类型徽标、结论、“谁知道什么”的表（没有表时是分点）、一行依据。收起：展开说明、覆盖范围与全部依据，点“详细”展开。

## 数据

nb-agent-ui 的工具节点组件：

```ts
defineProps<ToolComponentProps>();   // ctx、services、locale、call（参数是 answer 的参数，流式时可能是半截）
defineEmits<HostComponentEmits>();   // action：reference.open
```

- 出处（依据、表里的出处、结论与说明文字里的“章.段”）发 `{type: "reference.open", target: "paragraph://<标准写法>"}`。
- 人名发 `{type: "reference.open", target: "entity://<对象 id>"}`；只有查到唯一对象的才是链接。

## 隐藏通道理由

`state:inject`：人名的查法经 `QA_NAME_LOOKUP`（`names.ts`）从问答页注入。卡片挂在对话视图的工具节点里，属性由 nb-agent-ui 给，宿主的查法只能经祖先注入。没有注入时人名都是纯文字。

## 注意事项

- 依据一行的个数只按宽度算（`ref-line.ts` 的 `visibleRefCount`，ResizeObserver 量）：放不下的收成“等 N 处”，点它展开“详细”；“依据”标签与“详细”按钮不收。
- 量宽度用一份不显示的同样小块（`answer-ruler`），改小块的样式时两处一起改。
