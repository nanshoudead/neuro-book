---
标签: []
别名: ["候选菜单", "Prompt Menu"]
---

# PromptMenuPanel

`PromptEditor` 的候选菜单面板：触发菜单与输入历史搜索共用它。它只负责画——标题、按组分段的候选项、高亮与禁用、加载中与没有结果、底部按键提示，可选地在顶部放一个搜索框；高亮哪一项、键盘怎么移动由使用方决定。与 nb-ui `Popover` 不同，它不抢焦点：点击候选项不会让编辑器失焦。

## 布局与交互

- 自上而下：搜索框（可选）、标题行（可选）、候选项、底部按键提示。候选项区最多显示约 8 项，更多时内部滚动，高亮项保持在可见范围内。相邻且同组的项只显示一次组标题。
- 加载中在候选项后显示转圈与“正在加载”；不在加载、又没有候选项时显示空结果文字。
- 鼠标按下候选项不移走焦点；点击启用的项发出 `select`，移入发出 `highlight`。禁用项不响应。
- 搜索框里的输入与按键原样发出，由使用方处理方向键、回车与 Escape。

## 数据

```ts
interface PromptMenuPanelProps {
    /** listbox 的 id，候选项 id 为 `${id}-${index}`，供正文的 aria-controls 与 aria-activedescendant 使用。必填。 */
    id: string;
    /** 必填：界面语言，决定按钮与说明的文字。 */
    locale: DisplayLocale;
    title?: string;
    /** 必填。 */
    items: readonly PromptEditorMenuItem[];
    /** 高亮项的 id；默认 null。 */
    activeId?: string | null;
    /** 默认 false。 */
    loading?: boolean;
    /** 默认“没有匹配项”。 */
    emptyText?: string;
    /** 不为 null 时在顶部显示搜索框，值受控；默认 null。 */
    search?: string | null;
    /** 搜索框的占位与可访问名称；默认空字符串。 */
    searchLabel?: string;
}

interface PromptMenuPanelEmits {
    (e: "select", id: string): void;
    (e: "highlight", id: string): void;
    (e: "search", value: string): void;
    (e: "search-keydown", event: KeyboardEvent): void;
}

interface PromptMenuPanelExpose {
    /** 聚焦搜索框；没有搜索框时不做任何事。 */
    focusSearch(): void;
}
```

没有 slot。未声明的 attribute 落到面板根元素上。
