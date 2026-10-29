---
标签: [state:inject]
别名: ["卡片视图"]
---

# ShelfCards

书架的卡片视图（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 5、6）：书卡（[`BookCard`](BookCard.md)）排成网格，列数随宽度（每列至少 300px），最后一格是一张“新建作品”占位（样式同下面空书架的那张，底行写作品目录），最后一行没排满时它就补在空位里。空书架时网格里是两张和书卡同样大小的“待写的书”：“新建作品”（封面位是一个加号，底行写新作品会放在哪个作品目录）与“打开已有作品”（封面位是文件夹），书架从空到有只是网格里多了几张卡。

## 交互

- 网格是 `listbox`（有作品时）：左右方向键移动选中，上下按当前列数跳一行，Home、End 到两端，Enter 打开选中的作品，Delete 请求移出书架；聚焦时没有选中就选第一部。
- “新建作品”占位是列表框的最后一个选项（不是一部作品，`aria-selected` 总为 false）：方向键或 End 走到它时只高亮它、不改 `activeId`，Enter 发 `create`，Delete 不起作用；点它发 `create`。
- 点卡片选中并打开（`BookCard` 的 `pick`、`open`）；卡片上的“更多”另发事件。
- 空书架的两张卡是按钮，发 `create`、`add-existing`。

## 数据

```ts
type Props = {
    items: ReadonlyArray<ShelfItem>;
    activeId: string | null;
    now: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
    /** 空书架时写在“新建作品”卡上的作品目录。 */
    library: string;
};
type Emits = {
    "update:activeId": [id: string];
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
    create: [];
    "add-existing": [];
};
```

根节点带 `data-shelf-cards`；有作品时末尾占位带 `data-shelf-create-card`；空书架时根节点另带 `data-shelf-empty`，两张卡带 `data-shelf-create`、`data-shelf-add`。没有插槽与 expose。

## 隐藏通道理由

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
