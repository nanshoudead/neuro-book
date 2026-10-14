/**
 * 从页面、样式与脚本的文字里取出引用的地址，供发布时算产物的文件集（docs/file-formats.md 的“发布记录”）。
 * 只做词法上的提取，不解析路径：归一化（去掉 `?`、`#`，判断是否在产物目录里）在 artifacts.ts，与引用检查共用。
 * 本模块被前端经 questions.ts 间接导入，不能有 `node:` 依赖。
 *
 * 只认字面量：脚本里拼出来的地址、`<template>` 里的元素都追踪不到，漏掉的未跟踪文件会出现在
 * `unreferenced_files_not_committed` 里，由会话用 `--include` 补上。
 */

/** 一处引用；`lineOffset` 是它在所给文字里的第几行（从 0 起），调用方加上文字本身的起始行。 */
export type TextReference = {target: string; lineOffset: number};

function lineOffsetAt(text: string, index: number): number {
    let count = 0;
    for (let position = text.indexOf("\n"); position !== -1 && position < index; position = text.indexOf("\n", position + 1)) count += 1;
    return count;
}

function isAsciiWhitespace(char: string): boolean {
    return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * `srcset` 里各候选的地址，按 HTML 的候选语法：地址是一段不含空白的字符，后面是描述符，候选之间用逗号分隔。
 * 不能按逗号切：`assets/a,b.png 1x` 的地址本身含逗号，`data:` 地址里也有逗号。
 */
export function srcsetUrls(value: string): string[] {
    const urls: string[] = [];
    let index = 0;
    while (index < value.length) {
        while (index < value.length && (isAsciiWhitespace(value[index]!) || value[index] === ",")) index += 1;
        if (index >= value.length) break;
        const start = index;
        while (index < value.length && !isAsciiWhitespace(value[index]!)) index += 1;
        const url = value.slice(start, index);
        // 地址以逗号结尾时，这个候选没有描述符，逗号就是分隔符。
        if (url.endsWith(",")) {
            urls.push(url.replace(/,+$/u, ""));
            continue;
        }
        urls.push(url);
        // 描述符一直到下一个不在括号里的逗号。
        let inParens = false;
        while (index < value.length) {
            const char = value[index]!;
            index += 1;
            if (char === "(") inParens = true;
            else if (char === ")") inParens = false;
            else if (char === "," && !inParens) break;
        }
    }
    return urls.filter((url) => url !== "");
}

/** 把块注释换成同样多的换行：注释里的 `url(...)` 不算引用，后面引用的行号不变。 */
function blankComments(text: string, pattern: RegExp): string {
    return text.replace(pattern, (comment) => comment.replace(/[^\n]/gu, ""));
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/giu;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/giu;

/** 样式表（`.css`、内联 `<style>`、`style` 属性）里 `url(...)` 与 `@import "…"` 的地址。 */
export function cssReferences(text: string): TextReference[] {
    const source = blankComments(text, /\/\*[\s\S]*?\*\//gu);
    const found: Array<{index: number; target: string}> = [];
    for (const pattern of [CSS_URL, CSS_IMPORT]) {
        for (const match of source.matchAll(pattern)) {
            const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
            if (target !== "") found.push({index: match.index, target});
        }
    }
    return found.sort((left, right) => left.index - right.index).map(({index, target}) => ({target, lineOffset: lineOffsetAt(source, index)}));
}

/** `import … from "…"`、`import "…"`、`export … from "…"`；`import(` 与 `import.meta` 不匹配（`[\w$*{}\s,]` 里没有 `(`、`.`）。 */
const STATIC_IMPORT = /(?<![\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(["'])([^"'\n]+)\1/gu;
/** `import("…")`；模板字符串只认不含 `${` 的。 */
const DYNAMIC_IMPORT = /(?<![\w$.])import\s*\(\s*(?:(["'])([^"'\n]+)\1|`([^`$\n]+)`)\s*\)/gu;

/**
 * 脚本（`.js`、`.mjs`、内联的 `<script type="module">`）里字面量的 import 地址。
 * 只留浏览器会按路径或地址解析的：`./`、`../`、`/` 开头的与带协议的；裸模块名（`vue`）要靠 import map，不是产物里的文件。
 */
export function scriptImports(text: string): TextReference[] {
    // 不去掉脚本里的注释：字符串里常有 `/*`（`"src/**/*.js"`），按注释删会连带删掉后面真的 import；注释掉的 import 至多多报一条缺失。
    const source = text;
    const found: Array<{index: number; target: string}> = [];
    for (const match of source.matchAll(STATIC_IMPORT)) found.push({index: match.index, target: match[2]!});
    for (const match of source.matchAll(DYNAMIC_IMPORT)) found.push({index: match.index, target: match[2] ?? match[3]!});
    return found
        .filter(({target}) => /^(?:\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/iu.test(target))
        .sort((left, right) => left.index - right.index)
        .map(({index, target}) => ({target, lineOffset: lineOffsetAt(source, index)}));
}
