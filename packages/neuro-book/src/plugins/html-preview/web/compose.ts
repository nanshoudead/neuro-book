/**
 * 预览页的 `srcdoc`（docs/specs/workbench/html-preview.md 输出 3、5）：在文档开头插入 CSP、`<base>` 与页内锚点的处理脚本。
 * 纯函数，浏览器与 Bun 测试共用。
 *
 * 插入位置：开头的 doctype 之后（它前面只能有空白与注释），没有 doctype 就放最前面。浏览器解析时这几个元素进入隐含的
 * `<head>`，页面自己的 `<html>`、`<head>` 随后照常合并。不在正文里找 `<head>`：注释、脚本与属性里都可能出现这几个字，插进
 * 去保护就失效了（CSP 的 meta 只管它后面的内容）。不能放到 doctype 前面：那样页面进怪异模式。
 */

import {previewContentSecurityPolicy} from "nbook/plugins/files/shared/contracts";

/** 正文停手这么久才重载预览（docs/specs/workbench/html-preview.md 输出 4）。 */
export const PREVIEW_DELAY_MS = 300;

export interface ComposeOptions {
    /** 预览令牌对应的 URL 前缀，带应用源、以 `/` 结尾：`http://127.0.0.1:3100/api/nbook.files/preview/<令牌>/`。 */
    readonly base: string;
    /** 文件在作品里的路径（不含方案），例如 `site/index.html`。 */
    readonly path: string;
    /** 放行外网（“允许联网”开着，默认开）。 */
    readonly network: boolean;
}

/** 文件所在目录在令牌下的地址：各段按 URL 编码，以 `/` 结尾。 */
export function directoryUrl(base: string, path: string): string {
    const segments = path.split("/").slice(0, -1);
    return base + segments.map((segment) => `${encodeURIComponent(segment)}/`).join("");
}

/**
 * `#` 开头的链接改为页内滚动：有了 `<base>`，`#章节` 会按目录地址解析、把预览导航走。用捕获阶段，页面自己的处理照常收到
 * 事件；按 id 找不到时按 name 找（旧式的 `<a name>`）。
 */
const ANCHOR_SCRIPT = `document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest?t.closest("a[href^='#']"):null;if(!a)return;e.preventDefault();var id=decodeURIComponent(a.getAttribute("href").slice(1));var el=id===""?document.documentElement:(document.getElementById(id)||document.getElementsByName(id)[0]);if(el)el.scrollIntoView();},true);`;

const escapeAttribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");

/** 文档开头的 doctype：前面只有 BOM、空白与注释（注释到第一个 `-->` 为止，与 HTML 的规则相同）。 */
const LEADING_DOCTYPE = /^\uFEFF?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/iu;

export function composePreview(html: string, options: ComposeOptions): string {
    const injected = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewContentSecurityPolicy(options.base, options.network))}"><meta name="referrer" content="no-referrer"><base href="${escapeAttribute(directoryUrl(options.base, options.path))}"><script>${ANCHOR_SCRIPT}</script>`;
    const doctype = LEADING_DOCTYPE.exec(html);
    const at = doctype === null ? 0 : doctype[0].length;
    return html.slice(0, at) + injected + html.slice(at);
}
