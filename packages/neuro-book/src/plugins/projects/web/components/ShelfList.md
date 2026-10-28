---
标签: [state:inject]
别名: ["列表视图"]
---

# ShelfList

书架的列表视图（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 7）：一行一部作品，从左到右是 30px 的封面（[`BookCover`](BookCover.md)）、书名（宋体）与一行简介、字数与篇数、最近编辑时间与新鲜度说明（`stale` 写“统计于某时”，`counting` 写“正在统计”，正在打开的作品加“已打开”），行尾“更多”（在新窗口打开、编辑信息、从书架移除）。行之间是发丝线，不给面。容器窄于 640px 时字数与时间折到书名下面。

## 交互

点行打开作品；行是按钮，Tab 可达、回车打开。“更多”是 `DropdownMenu`，选项发对应事件。最后一行是“新建作品”（封面位是虚线框里的加号），点它发 `create`。

## 数据

```ts
type Props = {
    items: ReadonlyArray<ShelfItem>;
    now: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
};
type Emits = {
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
    create: [];
};
```

根节点带 `data-shelf-list`，每部作品的行 `data-shelf-row`；“新建作品”行的按钮带 `data-shelf-create-row`，不算作品行。没有插槽与 expose。

## 隐藏通道理由

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
