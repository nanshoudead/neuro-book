---
标签: [env:portal, env:timer]
---

# InfoTip

`InfoTip` 是字段标签或标题旁边的一个小问号图标，悬停或聚焦时用 `Tooltip` 显示一段说明。它代替各处手画的“圆圈里一个 i”：说明写在提示里，表单本身保持简洁。提示只放补充说明；用户必须知道才能填对的内容写在字段下面，不藏进提示。

## 布局

一个 18px 见方的按钮，中间是 14px 的问号圆圈图标（lucide `circle-help`）。平时用 `--text-muted`，悬停变 `--text-main`；键盘聚焦时画控件的焦点环。按钮不占行高：和标签文字同一行时按基线居中，不把标签行撑高。提示的外观、位置与延迟同 `Tooltip`。

## 交互

- 指针悬停经过 `Tooltip` 的延迟后显示说明，键盘聚焦时立即显示，Escape 关闭。
- 按钮能用 Tab 聚焦。它本身不抢初始焦点：放在对话框里时，打开后焦点落在哪里由对话框决定。
- 点击不做别的事，只是不打断已经显示的提示。

## 数据

```ts
type InfoTipPlacement = "top" | "bottom" | "left" | "right";

interface InfoTipProps {
    /** 说明文字；必填 */
    text: string;
    /** 按钮的可访问名称；默认 "说明" */
    label?: string;
    /** 提示首选显示方向；默认 "top" */
    placement?: InfoTipPlacement;
}
```

没有 emits、插槽与 expose。未声明的 attrs 落在按钮上（例如 `data-*`）。

## 不支持

不显示富文本或可交互内容（提示是不可交互的浮层），不做“点击切换常驻”的弹出说明；需要可点的说明用 `Popover`。
