---
标签: []
---

# 没核实的出处

文字回复下面的提醒一行（docs/specs/story/viewer.md 的问答页，w00024 t13 决定 8）：回复里写成出处的样子、这一轮却没读过或在阅读位置之后的段。问答页给那一轮最后一条回复加附注 `{customType: "nb-story.unverified-refs", text, details: {refs}}`（`turns.ts`），注册表的 `entries` 按这个 `customType` 登记本组件。

## 数据

```ts
defineProps<EntryComponentProps>();   // ctx、services、locale、annotation、message
defineEmits<HostComponentEmits>();    // action：reference.open（target 是 paragraph://<标准写法>）
```

`details.refs` 不是字符串数组时不列出处，只剩说明文字。
