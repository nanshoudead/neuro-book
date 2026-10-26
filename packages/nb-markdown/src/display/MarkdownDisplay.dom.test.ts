/**
 * MarkdownDisplay 不经任何插件挂上（docs/specs/ui/markdown-display.md；nb-story 这类宿主的用法）：没有提供宿主时用内置方言
 * 加核心语法与缺省的目标分类；宿主经 `provideMarkdownHost` 换语言；组不成语言时按纯文字显示、记诊断。
 * neuro-book 的方言、作品文件的小块与流式等其余条目由 `packages/neuro-book/src/plugins/markdown/web/components/
 * MarkdownDisplay.dom.test.ts` 经它的宿主挂组件运行。
 */

import {mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideMarkdownHost} from "../host";
import type {MarkdownHost} from "../host";
import {coreSyntax, createMarkdownLanguage} from "../language";
import MarkdownDisplay from "./MarkdownDisplay.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** 在一个提供宿主的外层组件里挂展示器；不给 `host` 时不提供。 */
function display(text: string, host?: Partial<MarkdownHost>) {
    const Outer = defineComponent({
        props: {text: {type: String, required: true}},
        setup: (props, {attrs}) => {
            if (host !== undefined) provideMarkdownHost(host);
            return () => h(MarkdownDisplay, {...attrs, locale: "zh-CN", text: props.text});
        },
    });
    const activations: unknown[] = [];
    const wrapper = mount(Outer, {props: {text}, attrs: {onActivate: (activation: unknown) => activations.push(activation)}, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, activations};
}

const settled = (wrapper: ReturnType<typeof display>["wrapper"]) => waitUntil("展示器画完", () => (wrapper.find("[data-markdown-display]").element.childElementCount > 0 ? true : null));

describe("不经插件挂上的展示器", () => {
    it("没有宿主：内置方言照常显示；别的方案的链接（nb-story 的出处）是引用小块，点击发 reference；外部链接发 link", async () => {
        const {wrapper, activations} = display("见[41.20](paragraph://41.20)与[官网](https://example.com)，<mark>重点</mark>。\n");
        await settled(wrapper);
        expect(wrapper.find("mark").text()).toBe("重点");
        const chip = wrapper.find("[data-reference-link='other']");
        expect(chip.text()).toBe("41.20");
        // 点链接本身：展示器在冒泡时拦下默认跳转，交给宿主（happy-dom 在链接上派发的点击没被拦下时会真的去取地址）。
        const clicks = ["a[href='paragraph://41.20']", "a[href='https://example.com']"].map((selector) => {
            const event = new MouseEvent("click", {bubbles: true, cancelable: true});
            wrapper.find(selector).element.dispatchEvent(event);
            return event.defaultPrevented;
        });
        expect(clicks).toEqual([true, true]);
        expect(activations).toEqual([{kind: "reference", target: "paragraph://41.20"}, {kind: "link", href: "https://example.com"}]);
    });

    it("宿主给的语言：只有核心语法时方言标签按原样显示", async () => {
        const {wrapper} = display("<mark>重点</mark>\n", {language: () => createMarkdownLanguage([coreSyntax])});
        await settled(wrapper);
        expect(wrapper.find("mark").exists()).toBe(false);
        expect(wrapper.text()).toContain("<mark>重点</mark>");
    });

    it("“失败与恢复”：组不成语言时按纯文字显示原文、记诊断，之后的更新照常显示新的原文", async () => {
        const reports: string[] = [];
        const {wrapper} = display("第一段 **粗**\n", {
            language: () => {
                throw new Error("组不成");
            },
            report: (event) => reports.push(event),
        });
        await waitUntil("纯文字", () => (wrapper.text() === "第一段 **粗**" ? true : null));
        expect(reports).toEqual(["markdown.display.failed"]);
        await wrapper.setProps({text: "第二段\n"});
        await waitUntil("新的原文", () => (wrapper.text() === "第二段" ? true : null));
    });
});
