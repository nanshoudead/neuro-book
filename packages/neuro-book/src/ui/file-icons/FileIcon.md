---
标签: []
别名: ["文件图标", "File Icon"]
---

# FileIcon

文件与文件夹图标，资源管理器的行（[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“行的样子”）与编辑器的标签（[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 53）共用：catppuccin 的彩色图标（MIT），亮色用 Latte 配色、暗色用 Macchiato，跟着页面根上的 `data-nb-appearance` 即时换色，不重新渲染。画成内联 SVG：颜色是 CSS 变量，UnoCSS 的图标类（mask 或 data URI）进不了变量。选哪个图标由调用方决定（文件按名字用同目录 `file-icons.ts` 的 `fileIconForName`，资源管理器的文件夹另有规则），本组件只画。不经 Vue 的地方（编辑器的装饰、展示器的静态视图）用同目录 `render.ts` 的 `renderFileIcon`，画出同样的元素。

## 数据

```ts
type Props = {
    /** 生成的图标表 `catppuccin.ts` 里的名字。 */
    icon: CatppuccinIcon;
};
```

- 16×16，不收缩；`aria-hidden`，意义由行的文字给出。
- 没有 emits、slots、expose；attrs 落在根 `svg` 上。

## 注意事项

- 配色的 16 个变量 `--file-icon-<色名>` 定义在同目录的 `palette.css`（`:root` 是 Latte，`[data-nb-appearance="dark"]` 是 Macchiato）；别处要用同一套颜色时用这些变量，不另抄色值。
- 图标表 `catppuccin.ts` 由 `bun run gen:file-icons` 生成；加图标先改生成脚本的清单。
