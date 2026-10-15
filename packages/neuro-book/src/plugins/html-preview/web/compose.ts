/**
 * 预览页的 `srcdoc`（docs/specs/workbench/html-preview.md 输出 3、5）：在文档开头插入 CSP、`<base>` 与页内锚点的处理脚本。
 * 纯函数，浏览器与 Bun 测试共用。
 *
 * 插入位置：`<head>` 之后；没有 `<head>` 时在 `<html>` 之后；都没有时在 doctype 之后，再没有就放最前面。不能放到 doctype
 * 前面：那样页面进怪异模式。CSP 的 meta 只管它后面的内容，所以它排第一个。
 */

import {previewContentSecurityPolicy} from "nbook/plugins/files/shared/contracts";

/** 正文停手这么久才重载预览（docs/specs/workbench/html-preview.md 输出 4）。 */
export const PREVIEW_DELAY_MS = 300;

export interface ComposeOptions {
    /** 预览令牌对应的 URL 前缀，带应用源、以 `/` 结尾：`http://127.0.0.1:3100/api/nbook.files/preview/<令牌>/`。 */
    readonly base: string;
    /** 文件在作品里的路径（不含方案），例如 `site/index.html`。 */
    readonly path: string;
    /** 用户打开了“允许联网”。 */
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

export function composePreview(html: string, options: ComposeOptions): string {
    const injected = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewContentSecurityPolicy(options.base, options.network))}"><meta name="referrer" content="no-referrer"><base href="${escapeAttribute(directoryUrl(options.base, options.path))}"><script>${ANCHOR_SCRIPT}</script>`;
    for (const pattern of [/<head(?:\s[^>]*)?>/iu, /<html(?:\s[^>]*)?>/iu, /<!doctype[^>]*>/iu]) {
        const match = pattern.exec(html);
        if (match !== null) {
            const at = match.index + match[0].length;
            return html.slice(0, at) + injected + html.slice(at);
        }
    }
    return injected + html;
}
