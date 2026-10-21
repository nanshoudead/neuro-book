---
标签: []
验证入口: DropdownMenu
---

# PopupScrollbar

弹出列表（`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`SuggestionMenu` 与级联菜单的每一级）共用的悬浮滑块，内部零件，不从包入口导出。几何与拖动都在 `usePopupScroll`，这里只画。

## 布局

4px 宽的胶囊，离外框右边 3px；宽度写死、不取 `--scrollbar-w`：弹层里有意比应用主滚动条（`OverlayScrollbar`）更窄，免得压住菜单项。轨道上下各让出 6px，滑块最短 20px；颜色取 `--scrollbar-thumb`，悬停 `--scrollbar-thumb-hover`，拖动 `--scrollbar-thumb-active`，几何与 `OverlayScrollbar` 共用 `utils/scrollbar-geometry`；只在视口可滚动时出现。滑块叠在外框上，视口在可滚动时右侧让出 6px，滑块不压在项的高亮与快捷键上。外框必须是定位元素，并且与视口是同一个 offsetParent。

## 交互

按下滑块拖动滚动视口，按下不夺走列表里的焦点，也不算选中某一项；指针捕获在滑块上，松开或取消时结束。指针位移按视口的 CSS 像素折算，Lab 画布缩放下也跟手。

## 数据

```ts
type PopupScrollbarProps = {
    /** usePopupScroll 的返回值 */
    scroll: PopupScroll;
};
```
