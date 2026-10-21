---
标签: []
验证入口: DropdownMenu
---

# MenuRow

弹出列表一行里面的几格，内部零件，不从包入口导出；`DropdownMenu`、`Menubar`、`ContextMenu`（经 `MenuNodes`）、`Select`、`SuggestionMenu` 与 `QuickPick` 的每一项都用它。行元素本身（reka 的菜单项与选择项、普通按钮、`role="option"`）和它上面的 `.nb-ui-menu-item`、`--multiline`、`-danger` 类仍由各列表给：几种行元素的角色、事件与高亮归属各不相同。

## 布局

从左到右：

- 左列（`.nb-ui-menu-item__icon`，16px）：勾与图标共用一列，勾选的项画勾、替代图标，其余项画自己的图标，没有图标的留空占位。这一级要不要留这一列由列表对整级算一次，经 `leadColumn` 传下来，名称才对得齐。
- 名称（`.nb-ui-menu-item__label`）：取内容宽度，放不下时截断。
- 右侧：父项画右箭头（`.nb-ui-menu-item__chevron`）；其余项画次要文字（`.nb-ui-menu-item__hint`：快捷键、路径或说明，右对齐，放不下时先截它）。
- 行尾（`trailing` 插槽）：列表自己的附加物，例如 `QuickPick` 的快捷键、`SuggestionMenu` 的勾。

行的外观（行高、字号、高亮、危险色）都在 `styles.css` 的 `.nb-ui-menu-item` 一组类里，这里只排格。

## 交互

不处理任何事件，交互归各列表。

## 数据

```ts
type MenuRowProps = {
    /** 名称；给了 `label` 插槽时不用 */
    label?: string;
    /** 这一级留不留左列 */
    leadColumn?: boolean;
    /** 左列画勾，替代图标 */
    checked?: boolean;
    /** 左列的 Iconify 类名 */
    icon?: string;
    /** 图标用次要色 */
    mutedIcon?: boolean;
    /** 右侧次要文字；给了 `right` 插槽时不用 */
    hint?: string;
    /** 父项：右侧画箭头，不画次要文字与 `right` 插槽 */
    submenu?: boolean;
};

type MenuRowSlots = {
    /** 替换整个名称格（例如 Select 用 reka 的 SelectItemText 当名称格） */
    label?: () => unknown;
    /** 左列里的内容（例如 Select 的状态点） */
    lead?: () => unknown;
    /** 替换右侧那格 */
    right?: () => unknown;
    /** 行尾的附加物 */
    trailing?: () => unknown;
};
```

插槽替换的是整格：替换了名称格或右侧格的，格上的类由插槽内容自己带。
