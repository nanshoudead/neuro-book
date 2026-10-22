---
标签: []
别名: ["可折叠行", "步骤行", "Step"]
---

# CollapsibleRow

列表里的一行：图标、动作名、操作对象，右侧可选增删行统计与状态。保证每一项默认只占一行，可展开时内容缩进显示在下方。

## 布局与交互

一行高至少 24px：图标、动作名、单行截断的操作对象，右侧是增删行统计（新增用成功色、删除用危险色）与运行中的转圈。传了 `expanded` 时整行是按钮，点击发出 `toggle`，展开后默认插槽缩进显示在下方；没传时不可展开。出错时整行用危险色。窄屏同一结构，操作对象先被省略。

键盘：可展开时整行是按钮，Tab 到达，回车或空格切换；焦点是行内的内嵌焦点线（行常常填满所在的列表，外扩的焦点环会被裁掉）。

左右内边距是宿主的覆盖点 `--nb-collapsible-row-px`（缺省 8px）：行排在已有缩进的列表里时，宿主把它收窄，让图标与上下文对齐。

## 数据

```ts
type CollapsibleRowStatus = "running" | "error" | "done";

type CollapsibleRowProps = {
    /** 图标 class，必填。 */
    icon: string;
    /** 动作名，必填。 */
    label: string;
    /** 操作对象，单行截断；默认空串。 */
    detail?: string;
    /** 增删行统计；null 的一侧不显示，另一侧有改动时为 0 的一侧也不显示。默认不显示。 */
    stat?: {added: number | null; removed: number | null} | null;
    /** 默认 "done"。running 显示转圈，error 整行用危险色。 */
    status?: CollapsibleRowStatus;
    /** 受控展开状态；不传表示不可展开。 */
    expanded?: boolean;
    /** 转圈的无障碍名称；不传时用 Spinner 的缺省文字。界面文字由调用方按语言传入。 */
    runningLabel?: string;
};

type CollapsibleRowEmits = {
    /** 点击可展开的行时发出，携带期望的新状态。 */
    (e: "toggle", expanded: boolean): void;
};

type CollapsibleRowSlots = {
    /** 展开后的内容；未展开时不渲染。 */
    default?: () => unknown;
};
```

没有 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 状态与边界

- 展开状态由调用方持有，组件只发出 `toggle`。
