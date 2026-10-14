import {describe, expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

/**
 * 滚动容器要做绝对定位后代的包含块（t15 阶段 4 第 1 批）。起因：nb-ui 复选框里 `sr-only`（`position: absolute`）的 input
 * 包含块落到外面 Splitter 那一格（`overflow: hidden`），点选项聚焦它时浏览器去滚那一格，整页内容被推出视野（多选题点了页面变空白）。
 * nb-ui 已在 label 上修好（t17，见 FormCheckbox.md），这条留作面板的防御性约定：别的绝对定位后代聚焦时也不会去滚外面的格子。
 * 布局在测试环境里量不到，这里按源码钉住约定。
 */
const WEB = join(import.meta.dir, "../src/web");
const SCROLL = /(?:^|\s)(?:[a-z]+:)*overflow(?:-[xy])?-(?:auto|scroll)(?:\s|$)/u;

function vueFiles(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => (entry.isDirectory() ? vueFiles(join(dir, entry.name)) : entry.name.endsWith(".vue") ? [join(dir, entry.name)] : []));
}

describe("滚动容器", () => {
    test("开了滚动的元素都带 relative（等宽预览块 pre 除外：里面没有表单控件）", () => {
        // 只认模板里的 class 与 :class（:class 认其中的字符串字面量与对象键）；scoped <style> 里写的 overflow 与 nb-ui 组件内部的滚动区扫不到。
        const RELATIVE = /(?:^|\s)relative(?:\s|$)/u;
        const missing: string[] = [];
        for (const file of vueFiles(WEB)) {
            const text = readFileSync(file, "utf8");
            const template = text.slice(text.indexOf("<template>"));
            for (const tag of template.matchAll(/<([a-zA-Z][\w-]*)/gu)) {
                if (tag[1] === "pre" || tag[1] === "template") continue;
                // 一个元素的属性在它的 “<” 与下一个 “<” 之间（属性值里的箭头函数有 “>”，没有 “<”）。
                const start = tag.index!;
                const next = template.indexOf("<", start + 1);
                const attributes = template.slice(start, next === -1 ? undefined : next);
                const fixed = /\sclass="([^"]*)"/u.exec(attributes)?.[1] ?? "";
                const literals = [...(/\s:class="([^"]*)"/u.exec(attributes)?.[1] ?? "").matchAll(/'([^']*)'/gu)].map((match) => match[1]!);
                const scrolling = [fixed, ...literals].filter((classes) => SCROLL.test(classes));
                if (scrolling.length === 0 || RELATIVE.test(fixed) || scrolling.every((classes) => RELATIVE.test(classes))) continue;
                missing.push(`${relative(WEB, file)}：<${tag[1]} ${scrolling.join(" | ").slice(0, 60)}…>`);
            }
        }
        expect(missing).toEqual([]);
    });

    test("共用的滚动类 nbdev-scroll-y 带 position: relative，外壳的 main 也带", () => {
        const css = readFileSync(join(WEB, "app.css"), "utf8");
        expect(/\.nbdev-scroll-y \{[^}]*position: relative;/u.test(css)).toBe(true);
        const app = readFileSync(join(WEB, "App.vue"), "utf8");
        expect(/<main id="nbdev-main"[^>]*class="[^"]*\brelative\b/u.test(app)).toBe(true);
    });
});
