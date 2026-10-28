/**
 * 组件从哪个端口取文字（`text.ts`，docs/specs/ui/i18n.md）：宿主注入的端口优先，根组件的 `locale` 不起作用；没有注入时根按
 * `locale` 建包内的缺省端口给子树；用 `render()` 挂在普通 DOM 上的图片（展示器的静态视图、编辑器的节点视图）经
 * `markdownViewContext` 读到同一个端口，端口换语言时不重挂就换文字。
 */

import {Editor} from "@tiptap/core";
import {mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref} from "vue";
import type {Ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {textRef} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import MarkdownDisplay from "../display/MarkdownDisplay.vue";
import MarkdownImage from "../display/MarkdownImage.vue";
import {createMarkdownEditorExtensions} from "../editor";
import type {MarkdownViewHost} from "../editor";
import {defaultMarkdownLanguage} from "../language";
import {NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE} from "../locales";
import {provideMarkdownHost} from "./index";
import {markdownViewContext, provideMarkdownText, useMarkdownText} from "./text";

const mounted: Array<{unmount(): void}> = [];
const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 宿主插件的目录：宿主给的图片说明可以引用它。 */
const PLUGIN = {"zh-CN": {missing: "{{name}}（不在作品里）"}, "en-US": {missing: "{{name}} (not in the work)"}};

/** 宿主的端口：nb-ui、本包与插件的目录，严格模式（缺键、缺参数抛错）。 */
function hostPort(initial: string): {port: TextPort; locale: Ref<string>} {
    const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_MARKDOWN_NAMESPACE]: NB_MARKDOWN_CATALOGS, demo: PLUGIN}, strict: true});
    const locale = ref(initial);
    return {locale, port: {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)}};
}

const provided = (port: TextPort) => ({global: {provide: {[TEXT_PORT_KEY as symbol]: port}}});

/** 子树里的零件：本包的一条文字、当前语言，以及嵌套的 nb-ui 控件经 `useText()` 看到的语言。 */
const Part = defineComponent({
    setup() {
        const text = useMarkdownText();
        const nested = useText();
        return () => h("span", {"data-part": ""}, `${text.t("prompt.pasteExpand")}|${text.locale.value}|${nested.locale.value}`);
    },
});

const Root = defineComponent({
    props: {locale: {type: String, default: undefined}},
    setup(props) {
        const text = provideMarkdownText(() => props.locale);
        return () => h("div", [h("b", text.t("prompt.pasteCollapse")), h(Part)]);
    },
});

const imageText = (root: {element: Element}): string => root.element.querySelector("[data-markdown-image]")?.textContent?.trim() ?? "";

describe("组件取文字的端口", () => {
    it("零件单独挂载、上面没有注入：包内的缺省端口，中文", () => {
        expect(mount(Part).text()).toBe("展开|zh-CN|zh-CN");
    });

    it("没有注入时根按 locale 建端口，子组件与嵌套的 nb-ui 控件拿到同一个；locale 变了跟着变", async () => {
        const root = mount(Root, {props: {locale: "en-US"}});
        expect(root.get("b").text()).toBe("Collapse");
        expect(root.get("[data-part]").text()).toBe("Expand|en-US|en-US");
        await root.setProps({locale: "zh-CN"});
        expect(root.get("[data-part]").text()).toBe("展开|zh-CN|zh-CN");
    });

    it("注入了端口时以它为准，根的 locale 不起作用；端口换语言不重挂就换", async () => {
        const {port, locale} = hostPort("en-US");
        const root = mount(Root, {props: {locale: "zh-CN"}, ...provided(port)});
        expect(root.get("[data-part]").text()).toBe("Expand|en-US|en-US");
        locale.value = "zh-CN";
        await nextTick();
        expect([root.get("b").text(), root.get("[data-part]").text()]).toEqual(["收起", "展开|zh-CN|zh-CN"]);
    });

    it("宿主给的图片说明可以是目录里的键：组件补上 name 经端口翻译；语言映射照旧代入 {name}", async () => {
        const {port, locale} = hostPort("zh-CN");
        const keyed = mount(MarkdownImage, {props: {src: "../外面.png", alt: "外面", missing: textRef("missing", undefined, "demo")}, ...provided(port)});
        const mapped = mount(MarkdownImage, {props: {src: "../外面.png", alt: "外面", missing: {"zh-CN": "{name}（别处）", "en-US": "{name} (elsewhere)"}}, ...provided(port)});
        expect([keyed.text(), mapped.text()]).toEqual(["外面（不在作品里）", "外面（别处）"]);
        locale.value = "en-US";
        await nextTick();
        expect([keyed.text(), mapped.text()]).toEqual(["外面 (not in the work)", "外面 (elsewhere)"]);
    });
});

describe("render() 挂在普通 DOM 上的组件", () => {
    const source = "![封面](a.png)\n\n见[第一章](chapter://1)\n\n<html>\n<b>x</b>\n</html>\n";

    it("展示器的静态视图：图片读到注入的端口，端口换语言不重挂就换文字；小块的提示与 HTML 卡片的按钮按画的时候的语言", async () => {
        const {port, locale} = hostPort("en-US");
        // 根的 locale 写成中文：读的是注入的端口，不是它。
        const display = mount(MarkdownDisplay, {props: {text: source, locale: "zh-CN"}, attachTo: document.body, ...provided(port)});
        mounted.push(display);
        await waitUntil("展示器画完", () => (imageText(display) === "封面 (not shown)" ? true : null));
        expect(display.get("[data-reference-link]").attributes("title")).toBe("Reference: 第一章 · chapter://1");
        expect(display.get(".nb-html-embed").text()).toContain("Render");
        locale.value = "zh-CN";
        await nextTick();
        expect(imageText(display)).toBe("封面（不显示）");
    });

    it("展示器没有注入：按自己的 locale 建端口，静态视图里的图片也用它，locale 变了跟着变", async () => {
        const display = mount(MarkdownDisplay, {props: {text: source, locale: "en-US"}, attachTo: document.body});
        mounted.push(display);
        await waitUntil("展示器画完", () => (imageText(display) === "封面 (not shown)" ? true : null));
        await display.setProps({locale: "zh-CN"});
        expect(imageText(display)).toBe("封面（不显示）");
    });

    it("编辑器的节点视图：宿主经 MarkdownViewHost.context 带进端口，图片跟着端口换语言；链接小块的提示用同一个端口", async () => {
        const {port, locale} = hostPort("en-US");
        const element = document.createElement("div");
        document.body.append(element);
        // 宿主的编辑器控件：在 setup 里取上下文、建编辑器（neuro-book 的 MarkdownControl 是这样做的）。
        const Control = defineComponent({
            setup() {
                provideMarkdownHost({});
                const host: MarkdownViewHost = {base: () => null, context: markdownViewContext(), assets: null, chips: {targets: {classify: () => ({kind: "other", name: ""}), encodeFile: (target) => target}, fileIcon: () => ({className: ""})}};
                const language = defaultMarkdownLanguage();
                const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host}), content: {type: "doc", content: [{type: "paragraph", content: [{type: "image", attrs: {src: "a.png", alt: "封面"}}, {type: "text", text: "第一章", marks: [{type: "link", attrs: {href: "chapter://1"}}]}]}]}});
                editors.push(editor);
                return () => h("div");
            },
        });
        mounted.push(mount(Control, provided(port)));
        expect(element.querySelector("[data-markdown-image]")?.textContent?.trim()).toBe("封面 (not shown)");
        expect(element.querySelector("[data-reference-link]")?.getAttribute("title")).toBe("Reference: 第一章 · chapter://1");
        locale.value = "zh-CN";
        await nextTick();
        expect(element.querySelector("[data-markdown-image]")?.textContent?.trim()).toBe("封面（不显示）");
    });

    it("编辑器的宿主不给上下文：图片与提示用包内的缺省端口，中文", () => {
        const element = document.createElement("div");
        const host: MarkdownViewHost = {base: () => null, assets: null, chips: {targets: {classify: () => ({kind: "other", name: ""}), encodeFile: (target) => target}, fileIcon: () => ({className: ""})}};
        const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language: defaultMarkdownLanguage(), placeholder: "", host}), content: {type: "doc", content: [{type: "paragraph", content: [{type: "image", attrs: {src: "a.png", alt: "封面"}}, {type: "text", text: "第一章", marks: [{type: "link", attrs: {href: "chapter://1"}}]}]}]}});
        editors.push(editor);
        expect(element.querySelector("[data-markdown-image]")?.textContent?.trim()).toBe("封面（不显示）");
        expect(element.querySelector("[data-reference-link]")?.getAttribute("title")).toBe("引用：第一章 · chapter://1");
    });
});
