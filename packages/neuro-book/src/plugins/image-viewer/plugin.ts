import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/**
 * 图片查看器（docs/specs/workbench/image-viewer.md）：向编辑器区贡献一个按字节显示、只看不改的编辑器。只有浏览器入口。
 */
export const descriptor: PluginDescriptor = {id: "nbook.image-viewer", version: PRODUCT_VERSION, locations: ["browser"]};
