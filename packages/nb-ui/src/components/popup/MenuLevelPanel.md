---
标签: [state:local]
验证入口: DropdownMenu
---

# MenuLevelPanel

手工级联菜单的一级面板，内部零件，不从包入口导出；`DropdownMenu`、`Menubar` 与 `ContextMenu` 的子菜单每一级都用它。

## 布局

固定定位，位置与宽高由宿主经 `useMenuCascade` 量好后给出：高度截在这一级第 9 项的中间并夹进窗口。面板里是这一级自己的滚动视口与悬浮滑块（`PopupViewport`），条目放在默认插槽。

## 交互

这一级滚动时（滚轮或拖滑块）发出 `scroll`，宿主据此收起它展开的更深层级，焦点留在这一级。换了父项（`contentKey` 变化）时视口回到顶部。面板本身可以接收焦点：指针离开项时焦点停在面板上，高亮清掉，方向键从首末项接着走。

## 数据

```ts
type MenuLevelPanelProps = {
    /** 宿主量好的 top、left、width、height，可以再加 zIndex */
    panelStyle: Record<string, string | number>;
    /** 同级换内容时为 true，内容淡入 */
    switching: boolean;
    /** 这一级展开自哪一项；换了父项时视口回到顶部 */
    contentKey?: unknown;
};

type MenuLevelPanelEmits = {
    (event: "scroll"): void;
};
```
