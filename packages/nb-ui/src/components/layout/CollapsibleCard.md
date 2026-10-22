---
标签: []
别名: ["可折叠卡片", "Card"]
---

# CollapsibleCard

带框的单元：头部是图标、标题、对象摘要与状态，正文可折叠。需要框住的内容（提问、命令、任务清单、未登记的工具等）用它，使用方只提供正文，不再各自画框。

## 布局与交互

头部一行：图标、标题、等宽的单行摘要（放不下时省略号），右侧是状态（运行中转圈、成功、出错、等待）与折叠箭头；`actions` 插槽在头部最右，点击它不触发折叠。传了 `expanded` 时头部整行是按钮，点击发出 `toggle`；没传时头部不可点击、正文常显。出错时边框用危险色。键盘：可折叠时头部是按钮，Tab 到达，回车或空格切换；焦点是头部内的内嵌焦点线。窄屏同一结构，摘要先被省略。

## 数据

```ts
type CollapsibleCardStatus = "running" | "waiting" | "success" | "error" | "neutral";

type CollapsibleCardProps = {
    /** 图标 class，必填。 */
    icon: string;
    /** 动作名，例如“运行命令”，必填。 */
    title: string;
    /** 操作对象的单行摘要，例如命令文本；默认空串，为空时不显示。 */
    subtitle?: string;
    /** 默认 "neutral"。running 显示转圈，error 用危险色。 */
    status?: CollapsibleCardStatus;
    /** 受控展开状态；不传表示正文常显、头部不可点击。 */
    expanded?: boolean;
    /** 转圈的无障碍名称；不传时用 Spinner 的缺省文字。界面文字由调用方按语言传入。 */
    runningLabel?: string;
};

type CollapsibleCardEmits = {
    /** 点击可折叠卡片的头部时发出，携带期望的新状态。 */
    (e: "toggle", expanded: boolean): void;
};

type CollapsibleCardSlots = {
    /** 正文；折叠时不渲染。 */
    default?: () => unknown;
    /** 头部右侧的操作，点击不会触发折叠。 */
    actions?: () => unknown;
};
```

没有 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 状态与边界

- 展开状态由调用方持有，组件只发出 `toggle`。
- 卡片可以嵌套，使用方自己控制层数。
