/**
 * 不经 Vue 画文件图标：编辑器的装饰与展示器的静态视图是普通 DOM，挂不了组件。画出的元素与 `FileIcon.vue` 相同（同一份图标表、
 * 同样的属性与类名），两边看起来一样。
 */

import {CATPPUCCIN_ICONS} from "./catppuccin";
import type {CatppuccinIcon} from "./catppuccin";
import "./palette.css";

export function renderFileIcon(document: Document, icon: CatppuccinIcon): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "h-4 w-4 shrink-0");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-file-icon", "");
    svg.setAttribute("data-icon", icon);
    // 图标表是生成脚本从固定的图标包里挑出的 SVG 片段，不含用户输入。
    svg.innerHTML = CATPPUCCIN_ICONS[icon];
    return svg;
}
