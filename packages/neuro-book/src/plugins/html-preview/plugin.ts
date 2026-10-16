import type {PluginDescriptor} from "nbook/manifest";

/**
 * HTML 预览（docs/specs/workbench/html-preview.md）：向编辑器区贡献 HTML 文件的预览编辑器，预览页在沙箱里运行，只经预览令牌
 * 读作品里的文件。只有浏览器入口。
 */
export const descriptor: PluginDescriptor = {id: "nbook.html-preview", version: "0.1.0", locations: ["browser"]};
