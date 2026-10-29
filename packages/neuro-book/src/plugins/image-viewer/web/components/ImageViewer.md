---
标签: [state:local, state:inject]
别名: ["图片查看器", "Image Viewer"]
---

# ImageViewer

图片查看器的控件（[`workbench/image-viewer.md`](../../../../../../../docs/specs/workbench/image-viewer.md)）：按编辑器控件合同收到字节绑定（`shared/contracts.ts` 的 `BytesEditorBinding`），用绑定的 `url` 读取图片并显示，只看不改。同组的图片标签共用这一个控件，换文档只换绑定。

## 数据

```ts
type Props = {
    binding: BytesEditorBinding | null;
    /** 编辑器区给每组的实例槽；这个控件没有要跨重挂保留的实例，不用它。 */
    host: ViewStateSlot;
    readonly: boolean;
    visible: boolean;
    /** 内容区的可访问名称（文件名）。 */
    label: string;
    /** 只用于大小的数字格式（`Intl.NumberFormat`）；界面文字经翻译端口，不看它。 */
    locale: DisplayLocale;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

句柄只有 `focus`、`flushPendingChange`（无事可做）与 `status`：“1920 × 1080 · 245 KB · 50%”，读取失败或还没读到时为 null。

## 布局与状态

- 内容区可聚焦（`tabindex="0"`），底色是面板底色；图片后面是棋盘格（两种格色由 `--text-main` 按比例混入面板底色得到，明暗两态都看得出透明处）。
- 读取：`fetch(url, {cache: "no-cache"})` 取 blob、生成对象 URL，再用 `Image.decode()` 拿到像素尺寸；新图解码完之前继续显示旧图。换绑定、卸载时取消在途读取并撤销上一张图的对象 URL。`version` 变了重新读。
- 适应与原尺寸：缺省“适应”（只缩小不放大，按内容区大小随时重算）；单击图片在“适应”与 100% 之间切换；Ctrl（macOS 上 Cmd）加滚轮按指针位置缩放，10%–1600%；键盘 `+`、`-` 缩放，`0` 回到适应，`1` 为 100%。超出内容区时滚动查看。比例、模式与滚动位置存进绑定的视图状态槽，切走再切回不变。
- 读取期间空白，800 ms 后仍未读完才显示“正在读取”（CSS 动画延迟）；失败时一行原因（文件不在、项目已关闭、太大、不是能显示的图片）与“重试”，`version` 再变时自动重试。`url` 为 null（没有绑定项目）时说明只能显示作品里的文件。

## 不支持

- 不编辑、不另存；不逐帧控制动图；不显示 EXIF。

## 隐藏通道理由

- `state:local`：当前显示的图与对象 URL、读取阶段、失败说明、视图状态（模式、比例、滚动位置）。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，“正在读取”“重试”与各种失败说明都在本插件的目录（命名空间 `nbook.image-viewer`，`../../locales/`）。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。失败说明是出错那一刻翻成的字符串，之后切换语言不更新。
