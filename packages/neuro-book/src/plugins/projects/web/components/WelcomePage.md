---
标签: [state:inject]
别名: ["欢迎页", "Welcome Page"]
---

# WelcomePage

编辑区里的欢迎页（[`workbench/bookshelf.md`](../../../../../../../docs/specs/workbench/bookshelf.md) 的“欢迎页”）：作品概况、开始、最近打开与入门四块。它是受控零件：作品信息、统计、快捷入口与最近打开都经 props 进来，动作经事件交给宿主（`web/welcome.ts`），宿主再新建文件、执行命令或整页导航；组件不知道命令 id，也不持有文件客户端。

## 布局

纸面一样的单列：版心 720px（含左右各 48px 留白）、上 72px 下 96px，居中。顶部是书名（展示字体 30px）、简介（没有时写“还没有简介”）与一行统计（字数 · 篇数，过时的统计带“统计于…”；还没统计时写“尚未统计”）。其下两栏：左“开始”（主按钮“新建章节”，快捷入口，“回到书架”），右“最近打开”（文件名与所在目录，至多 5 个；没有时一句“还没有打开过文件”）；窄于 560px 时两栏上下排列。最后是“入门”三条固定提示，第二条带命令面板的快捷键（nb-ui `Kbd`）。

没有绑定项目（`title` 为 null）时只显示“没有打开作品”与“回到书架”。

## 数据

```ts
type Props = {
    /** 作品的显示名；没有绑定项目时为 null。 */
    title: string | null;
    description: string | null;
    /** 书架的统计摘要（`ShelfStats`）；还没取到为 null，不显示统计行。 */
    stats: ShelfStats | null;
    /** `formatWhen` 的“现在”（ISO）。 */
    now: string;
    /** 快捷入口：项目根下名字以“大纲”“设定”开头的文件与文件夹。 */
    quick: ReadonlyArray<{address: string; name: string; kind: "file" | "folder"}>;
    /** 最近打开的地址，最近在前；组件只取前 5 个。 */
    recent: ReadonlyArray<string>;
    /** 新建章节进行中：按钮忙。 */
    creating?: boolean;
    /** 新建章节失败的原因；默认 null。 */
    problem?: string | null;
    /** 命令面板的快捷键，例如 `Ctrl+Shift+P`；没有时第二条提示不带按键。 */
    shortcut?: string | null;
};

type Emits = {
    (event: "new-chapter"): void;
    /** 打开文件：快捷入口里的文件与最近打开。 */
    (event: "open", address: string): void;
    /** 在资源管理器里揭示文件夹：快捷入口里的文件夹。 */
    (event: "reveal", address: string): void;
    (event: "shelf"): void;
};
```

无 slots、无 expose；attrs 落在根元素（`data-welcome-page`）。

## 交互

- “新建章节”是主按钮；其余入口是带图标的文字按钮（强调色文字，悬停加下划线），键盘可达，焦点用全局焦点环。
- 快捷入口的文字是“打开 + 名字”（文件去掉 `.md`），旁边淡色写出文件名，文件夹以 `/` 结尾。
- 最近打开每项是文件名，右侧淡色写出所在目录（根目录不写）。

## 隐藏通道理由

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

- 不编辑作品信息（归书架的“编辑信息”）；不显示封面。
