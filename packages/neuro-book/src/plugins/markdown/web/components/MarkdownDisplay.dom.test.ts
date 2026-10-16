/**
 * MarkdownDisplay（同名 .md；docs/specs/ui/markdown-display.md）：方言的外观与编辑器一致、流式更新只替换变了的块、交互出口与
 * 释放。语言与编辑器同一份（内置方言），编辑器一侧用同一套扩展建真实的 Tiptap 编辑器。
 */

import {Editor} from "@tiptap/core";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {codecFor} from "../codec/codec";
import {createMarkdownEditorExtensions} from "../editor/markdown-editor-extensions";
import {markdownLanguage} from "../syntax";
import {SyntaxCatalog, syntaxCatalogKey} from "../syntax-catalog";
import MarkdownDisplay from "./MarkdownDisplay.vue";
import type {ResolveAsset} from "./MarkdownImage.vue";

/** nbook.markdown 交组件时给的方言目录：没有外来方言。 */
const catalog = new SyntaxCatalog({get: () => null, list: () => []}, () => undefined);
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function display(props: {text: string; streaming?: boolean; resolveAsset?: ResolveAsset}) {
    const wrapper = mount(MarkdownDisplay, {props: {locale: "zh-CN", ...props}, attachTo: document.body, global: {provide: {[syntaxCatalogKey as symbol]: catalog}}});
    cleanups.push(() => wrapper.unmount());
    return wrapper;
}

/** 等下一帧的更新做完（展示器在下一帧读入）。 */
async function settled(wrapper: ReturnType<typeof display>, check: (root: HTMLElement) => boolean): Promise<void> {
    await waitUntil("展示器更新", () => (check(wrapper.element as HTMLElement) ? true : null));
}

const CORPUS = [
    "她抬头<comment body=\"节奏太快\">看了他一眼</comment>，远处站着<ruby text=\"hàn zì\">汉字</ruby>先生，==高亮==与 x<sup>2</sup>。",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked toward the altar.",
    "</bilingual>",
    "",
    "> [!WARNING]- 伏笔",
    "> 折叠的内容。",
    "",
    "<html>",
    "<b>卡片</b>",
    "</html>",
    "",
    "见[<comment body=\"出场\">林</comment>雪](/设定/林雪.md)与[官网](https://example.com)，按 <kbd>Ctrl</kbd> 保存。",
    "",
].join("\n");

/** 方言元素的结构：标签名、`nb-` 开头的类名与方言的数据属性，按文档顺序。 */
function dialectShape(root: Element): string[] {
    return [...root.querySelectorAll("*")]
        .filter((element) => [...element.classList].some((name) => name.startsWith("nb-")) || ["comment", "ruby", "mark", "sup"].includes(element.tagName.toLowerCase()) || element.hasAttribute("data-callout"))
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].filter((name) => name.startsWith("nb-")).sort().join(".")}${element.hasAttribute("data-callout") ? `[${element.getAttribute("data-callout")}]` : ""}`);
}

describe("Spec ui.markdown-display", () => {
    it("场景 3、输出 2、3：同一份语料，展示器与编辑器的方言元素结构与类名一致；作品里的链接是一个引用小块", async () => {
        const wrapper = display({text: CORPUS});
        await settled(wrapper, (root) => root.querySelector(".nb-callout") !== null);
        const language = markdownLanguage();
        const element = document.createElement("div");
        document.body.append(element);
        const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => null, locale: () => "zh-CN", assets: null}}), editable: false});
        cleanups.push(() => {
            editor.destroy();
            element.remove();
        });
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, codecFor(editor.schema, language).read(CORPUS).doc.content));
        expect(dialectShape(wrapper.element)).toEqual(dialectShape(editor.view.dom));
        expect(wrapper.element.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("true");
    });

    it("场景 1、输出 6、7：流式追加时开头的批注与折叠的提示块元素不变、仍折叠；光标在末尾，流式结束后去掉", async () => {
        const start = "<comment body=\"意见\">完整的第一段。</comment>\n\n> [!NOTE]- 伏笔\n> 内容\n\n末段";
        const wrapper = display({text: start, streaming: true});
        await settled(wrapper, (root) => root.querySelector(".nb-callout") !== null);
        const first = wrapper.element.firstElementChild;
        const callout = wrapper.element.querySelector(".nb-callout");
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")?.parentElement?.textContent).toContain("末段");
        let text = start;
        for (const piece of ["继续", "写下去。", "\n\n新的一段"]) {
            text += piece;
            await wrapper.setProps({text});
            await settled(wrapper, (root) => (root.textContent ?? "").includes(piece.trim()));
            expect(wrapper.element.firstElementChild).toBe(first);
            expect(wrapper.element.querySelector(".nb-callout")).toBe(callout);
            expect(callout?.getAttribute("data-callout-folded")).toBe("true");
        }
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")?.parentElement?.textContent).toContain("新的一段");
        await wrapper.setProps({streaming: false});
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")).toBeNull();
    });

    it("输出 6：后面新出现的引用定义改变了前面块的含义，前面那块也重画", async () => {
        const wrapper = display({text: "见[甲][r]。\n\n末段\n"});
        await settled(wrapper, (root) => (root.textContent ?? "").includes("末段"));
        expect(wrapper.element.querySelector("a")).toBeNull();
        await wrapper.setProps({text: "见[甲][r]。\n\n末段\n\n[r]: /设定/甲.md\n"});
        await settled(wrapper, (root) => root.querySelector("a") !== null);
        expect(wrapper.element.querySelector("a .nb-chip-link")?.textContent).toBe("甲");
    });

    it("输出 5：点引用小块、外部链接与图片发出 activate，不自己跳转；提示块的标题切换折叠", async () => {
        const wrapper = display({text: "见[林雪](/设定/林雪.md)与[官网](https://example.com)。\n\n![封面](/图/封面.png)\n\n> [!TIP]- 标题\n> 内容\n", resolveAsset: async () => ({url: "/raw/封面.png", release: () => undefined})});
        await settled(wrapper, (root) => root.querySelector("img") !== null);
        const anchors = wrapper.element.querySelectorAll("a");
        const click = (target: Element): boolean => target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(click(anchors[0] as Element)).toBe(false);
        click(anchors[1] as Element);
        click(wrapper.element.querySelector("img") as Element);
        expect(wrapper.emitted("activate")).toEqual([[{kind: "reference", target: "/设定/林雪.md"}], [{kind: "link", href: "https://example.com"}], [{kind: "image", address: "/图/封面.png"}]]);
        const title = wrapper.element.querySelector(".nb-callout__title") as HTMLElement;
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("true");
        title.click();
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("false");
    });

    it("场景 4、输出 8：块被替换与卸载时释放图片；渲染中的 `<html>` 块被替换后沙箱不在了", async () => {
        const released: string[] = [];
        const resolveAsset = async (src: string) => ({url: `/raw/${src}`, release: () => released.push(src)});
        const wrapper = display({text: "![甲](a.png)\n\n<html>\n<b>卡片</b>\n</html>\n", resolveAsset});
        await settled(wrapper, (root) => root.querySelector("img") !== null);
        (wrapper.element.querySelector(".nb-html-embed__toggle") as HTMLElement).click();
        expect(document.querySelectorAll(".nb-html-embed__frame")).toHaveLength(1);
        await wrapper.setProps({text: "![乙](b.png)\n\n<html>\n<b>换了</b>\n</html>\n"});
        await settled(wrapper, (root) => root.querySelector("img")?.getAttribute("src") === "/raw/b.png");
        await flushPromises();
        expect(released).toEqual(["a.png"]);
        expect(document.querySelectorAll(".nb-html-embed__frame")).toHaveLength(0);
        wrapper.unmount();
        cleanups.pop();
        expect(released).toEqual(["a.png", "b.png"]);
        expect(document.querySelector("[data-markdown-display]")).toBeNull();
    });
});
