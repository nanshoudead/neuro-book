---
标签: []
别名: ["文件浏览", "目录浏览"]
---

# FileBrowser

一层目录的浏览控件：上面一行面包屑是当前位置，下面是这一层的条目（目录或文件），选一项、进一层、回上一级。它是纯展示的：
数据来源（本机、服务端、某个 URI 方案）由宿主提供，进入目录后列什么也由宿主经事件决定。选择器对话框（选作品目录、另存为）
在它外面包一层窗口与确认按钮。

## 布局

上面一行是 `Breadcrumb`（除最后一段都可点），下面是一个可滚动的列表（缺省最高 232px，宿主可用 `--nb-file-browser-max-height` 改）。
有上一级时列表第一行是“..”。每条目从左到右：图标（目录或文件；给了 `swatch` 时是一个小色块）、名字（单行截断）、右侧的说明文字。
加载中显示 `Spinner`；`error` 非空时代替列表显示原因；没有条目时显示 `emptyText`。整块是控件档的圆角与描边，面取输入框的底；列表得到键盘焦点时焦点环画在整块的外框上，不画在列表自己身上。

## 交互

- 单击条目选中它（`update:selectedId`）；双击目录或在选中的目录上回车发 `navigate(目录 id)`，双击文件或回车发 `activate(id)`。
- 点面包屑的某一段发 `navigate(那一段的 path)`；点“..”或按 Backspace 发 `up`。
- 列表是 `listbox`：上下方向键在可选条目间移动，Home、End 到两端；`disabled` 的条目跳过、不能选中也不能进入。
- 换了目录（`entries` 变了）后选中项不在列表里时发 `update:selectedId(null)`。

## 数据

```ts
interface FileBrowserSegment {
    label: string;
    /** 点这一段时经 navigate 交回 */
    path: string;
}

interface FileBrowserEntry {
    /** 目录的 id 就是进入它时经 navigate 交回的路径 */
    id: string;
    name: string;
    kind: "directory" | "file";
    badge?: string;
    badgeTone?: "muted" | "accent";
    disabled?: boolean;
    iconClass?: string;
    swatch?: string;
}

interface FileBrowserProps {
    segments: FileBrowserSegment[];
    entries: FileBrowserEntry[];
    selectedId?: string | null;
    loading?: boolean;
    error?: string;
    emptyText?: string;
    upLabel?: string;
    /** 列表的可访问名称；默认“目录” */
    label?: string;
}

interface FileBrowserEmits {
    (e: "update:selectedId", id: string | null): void;
    (e: "navigate", path: string): void;
    (e: "up"): void;
    (e: "activate", id: string): void;
}
```

没有插槽与 expose。未声明的 attrs 落在根节点（`data-file-browser`）上。

## 不支持

不读文件系统、不记路径历史、不多选、不拖放；新建文件夹、重命名这类写操作由宿主在窗口里另给按钮。
