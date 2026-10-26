---
标签: [state:local]
验证入口: Menubar
---

# PopupViewport

弹出列表的滚动视口加悬浮滑块，内部零件，不从包入口导出；`Menubar` 的每组菜单与级联菜单的每一级（`MenuLevelPanel`）各用一个，每个零件持有自己的一份 `usePopupScroll`。

## 布局

两个并列的根：滚动视口（`.nb-ui-popover-scroll`，截断高度、渐隐、可滚动时右侧让出 6px）与 `PopupScrollbar`。放在定位的外框里，外框是纵向 flex 时视口是能收缩的那一块；未声明的属性（`class`、`data-*`）落到视口上。

## 交互

视口滚动时发出 `scroll`，宿主据此收起更深的级联层级。`contentKey` 变化时视口回到顶部。

## 数据

```ts
type PopupViewportProps = {
    /** 换成另一份内容的标识；变化时滚回顶部 */
    contentKey?: unknown;
};

type PopupViewportEmits = {
    (event: "scroll"): void;
};

type PopupViewportExpose = {
    scroll: PopupScroll;
};
```
