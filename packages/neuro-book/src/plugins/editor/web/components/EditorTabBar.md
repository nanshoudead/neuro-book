---
标签: [state:local]
别名: ["标签条", "Tab Bar"]
---

# EditorTabBar

编辑组的标签条（受控）：每个打开的标签一项，标签条与标签之间都不画线，活动标签用加粗的正文色区分（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38；每个标签的宽度按加粗预留，切换活动标签时标签不变宽变窄），preview 标签用斜体，有未保存修改的标签在关闭按钮的位置显示圆点（悬停时换回关闭）。

## 数据

```ts
type TabItem = {id: string; label: string; title: string; preview: boolean; dirty: boolean; active: boolean};

type Props = {
    tabs: ReadonlyArray<TabItem>;
    /** tablist 的可访问名称。 */
    label: string;
    /** 关闭按钮的可访问名称（参数是标签名）。 */
    closeLabel: (label: string) => string;
    /** 未保存标记的读屏文字。 */
    unsavedLabel: string;
};

type Emits = {
    activate: [id: string];
    /** 双击：preview 转正。 */
    pin: [id: string];
    close: [id: string];
    /** Alt+←/→：同组里移动一位。 */
    move: [id: string, delta: -1 | 1];
    /** 右键、Shift+F10 或菜单键：在视口坐标打开这个标签的菜单（键盘打开时取标签的左下角）。 */
    menu: [id: string, x: number, y: number];
};
```

## 交互

`role="tablist"`，标签是 `role="tab"` 的按钮，只有活动标签在 Tab 顺序里（roving tabindex）。←/→ 换到相邻标签（循环）并激活，Home/End 到首末，Delete 关闭当前标签，Alt+←/→ 移动；中键点击关闭。右键不把焦点给标签（右键按下时不聚焦），所以不让这一组成为活动组。关闭按钮不进 Tab 顺序，键盘用 Delete。标签按钮填满标签条的高度、条又横向滚动，焦点画成标签里面的一圈内嵌焦点线；关闭按钮同样（较紧的主题里它离条的边不到 3.5px）。标签放不下时横向滚动，条末尾留 4px（编辑组落在半像素上时，没有这点余量滚到底也露不全最后一个标签）；活动标签换了（新打开、键盘切换）时滚到它完整可见。

`state:local`：标签列表元素的引用，用来在键盘切换后把焦点放到新的活动标签上。
