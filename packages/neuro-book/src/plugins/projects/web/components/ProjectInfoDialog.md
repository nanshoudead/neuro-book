---
标签: [state:local, state:inject, env:portal, env:global]
别名: ["作品信息对话框", "新建作品"]
---

# ProjectInfoDialog

新建作品与编辑作品信息共用的模态对话框（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 11、13）：nb-ui [`Dialog`](../../../../../../nb-ui/src/components/feedback/Dialog.md)，700px 宽（窄容器里收窄），居中、不能拖动。只收集与校验输入：书名必填、至多 80 个字符；简介至多 500 个字符；主题色是 `#rrggbb` 或自动。提交交给宿主。

## 布局

左栏：封面位 [`BookCover`](BookCover.md)（150px，有图显示图，没图按当前书名与主题色实时排一张）、“上传封面…”（有封面时“换封面…”与“移除封面”）、说明图标里写格式与上限；下面是主题色：标签加说明图标，`ColorSwatches` 两行五列（“自动”、八档色板、“自定义”）。“自动”色块画的就是封面现在用的那个自动色；“自定义”在旁边打开取色面板。主题色改的就是封面，放在封面下面，改了立刻看到。

右栏：书名（计数只在超过上限八成时出现在标签右边）、简介（占位写它显示在哪；输入框占满右栏剩下的高度，两栏底部对齐）、保存位置（只在新建时：目录输入框，由书名生成的文件夹名作为灰色后缀实时变化；“浏览…”与输入框同高，开目录选择器；说明图标里写目录不存在会一并创建）。页脚取消与确认（新建时“新建”，编辑时“保存”）。

说明都在标签旁的 `InfoTip` 里，不占行（规范：元信息走 tooltip）。容器窄于 560px 时两栏改为上下排。

## 交互

- 打开时按 `initial` 重置输入与校验结果，焦点落在书名；回车提交。
- 校验不在字段下插字（规范：校验结果不改变表单的排版）：书名空着、新建时没有保存位置，或长度、颜色不合规时“新建”“保存”不可用，不发 `submit`。服务端针对字段的拒绝由宿主经 `fieldErrors` 交回：那个字段标为无效并得到焦点，原因写在页脚的状态行（`Dialog` 的 `status`，一次一条，先字段、再封面文件）。
- 选封面文件时本地先按类型与大小拒绝（只收 PNG、JPEG、WebP，至多 5 MB），原因写在状态行；通过的用对象 URL 预览，提交时随 `cover` 交出。
- `busy` 时禁止提交与关闭，输入控件禁用。取消与 Escape 发 `cancel`，由宿主关闭。
- 点遮罩：没改过任何输入时发 `cancel`；改过（书名、简介、主题色、封面，新建时还有保存位置）之后不关，免得误点丢掉输入。
- “浏览…”发 `browse-location`，宿主打开的目录选择器叠在本对话框上面。

## 数据

```ts
type ProjectCoverChange = {kind: "keep"} | {kind: "set"; file: File} | {kind: "remove"};
type Props = {
    open: boolean;
    mode: "create" | "edit";
    initial?: {title: string; description: string; color: string | null; coverSrc?: string | null; id?: string};
    busy?: boolean;
    /** 新建时作品放在哪个目录下（受控）。 */
    location?: string;
    fieldErrors?: Partial<Record<"title" | "description" | "location", string>>;
};
type Emits = {
    submit: [values: {title: string; description: string; color: string | null; parent: string | null; cover: ProjectCoverChange}];
    cancel: [];
    "update:location": [path: string];
    "browse-location": [];
};
```

`submit` 的 `title`、`description` 已去掉首尾空白；`color` 是小写的 `#rrggbb` 或 null；`parent` 去掉了末尾的分隔符，编辑时为 null。

不透传 attrs。表单带 `data-project-info`，字段 `data-project-title`、`data-project-description`、`data-project-color`（色板外层，色块是其中的 `data-color-swatch`）、`data-project-location-input`，封面 `data-project-cover-pick`、`data-project-cover-input`，页脚 `data-project-confirm`、`data-project-cancel`。

## 隐藏通道理由

`state:local`：输入、本地校验结果与封面预览的对象 URL 随本次打开。`env:portal`、`env:global`：来自 `Dialog`（传送到宿主目标；模态的焦点、Escape 与滚动锁，以及全应用一份的已打开模态列表）。

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不自己调远程服务，不记住上次的输入，不裁剪封面。
