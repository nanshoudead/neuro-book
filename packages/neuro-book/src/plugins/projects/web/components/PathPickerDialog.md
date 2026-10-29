---
标签: [state:local, state:inject, env:portal, env:global]
别名: ["目录选择器", "打开已有作品"]
---

# PathPickerDialog

选一个服务端上的目录的模态对话框（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 12）：nb-ui [`Dialog`](../../../../../../nb-ui/src/components/feedback/Dialog.md) 包 [`FileBrowser`](FileBrowser.md)，数据经 `source.list` 取（产品里是 `nbook.projects/projects` 的 `browse`）。两种用途：`project` 选一部作品（“打开已有作品”），`directory` 选一个目录（“更改作品目录”）。

## 布局

标题旁一个说明图标，悬停说明选什么（作品文件夹里有 `.nbook`；选目录时新建会把它建出来）。正文是目录浏览（最高 280px）；页脚左边是状态行“已选 …”，右边键盘图标（切到输入路径）、取消与确认（选作品时“加入书架”，选目录时“选定”）。宿主给了 `error` 时它替下“已选 …”写在状态行里，浏览器下面不插字，输入保留。

## 交互

- 打开时列 `initialPath`（null 为作品目录），焦点落在目录列表上；进入目录、面包屑、“..”都重新列；列失败在浏览器里显示原因。
- 从别的对话框里打开（新建作品的“浏览…”）时叠在它上面；Escape 与点遮罩只关选择器，焦点回到打开它的按钮。
- 条目：作品目录带“作品 · 书名”和色块；已在书架上的带“已在书架上”，选作品时不能选。
- 选作品模式：单击选中，双击或回车一个作品目录就是确认；普通目录进入。选目录模式：没选条目时确认交出当前目录。
- 键盘图标：出现一个路径输入框，回车进入那个目录（认 `~`），Escape 只收起输入框、不关选择器。
- 确认发 `pick(path)`；取消、Escape 与点遮罩发 `cancel`。`busy` 时不能确认与关闭。

## 数据

```ts
interface PathPickerSource {
    list(path: string | null): Promise<{ok: true; value: {path: string; parent: string | null; entries: BrowseEntry[]}} | {ok: false; message: string}>;
}
type Props = {
    open: boolean;
    mode: "project" | "directory";
    source: PathPickerSource;
    initialPath?: string | null;
    error?: string;
    busy?: boolean;
};
type Emits = {pick: [path: string]; cancel: []};
```

不透传 attrs。正文带 `data-path-picker`，确认按钮 `data-path-picker-confirm`，路径输入 `data-path-picker-input`。

## 隐藏通道理由

`state:local`：列出的目录与选中项随本次打开，关了就丢。`env:portal`、`env:global`：来自 `Dialog`（传送到宿主目标；模态的焦点、Escape 与滚动锁，以及全应用一份的已打开模态列表）。

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不新建文件夹、不重命名、不列文件；桌面壳的原生目录对话框另接。
