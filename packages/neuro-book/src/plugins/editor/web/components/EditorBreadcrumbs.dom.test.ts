/**
 * EditorBreadcrumbs（同名 .md，docs/specs/workbench/editor.md 输出 60）：段、目录下拉（进下一层、打开文件、读取中、失败与
 * 重试、迟到的结果丢掉）、大纲下拉（带打开时的身份交出、身份变了关上）、键盘。目录读取是测试手里的 Promise：它就是
 * 宿主交给组件的 `list` 接口，按需 resolve 才能摆出“读取在途时换段”的先后。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {EditorOutline} from "../../shared/contracts";
import {editorText} from "../../shared/text";
import type {EditorTextKey} from "../../shared/text";
import {editorCatalogs} from "../text";
import EditorBreadcrumbs from "./EditorBreadcrumbs.vue";
import type {BreadcrumbListing, BreadcrumbSegment} from "./EditorBreadcrumbs.vue";

const SEGMENTS: BreadcrumbSegment[] = [
    {kind: "root", label: "长夜", address: "project://"},
    {kind: "dir", label: "正文", address: "project://正文"},
    {kind: "file", label: "第二章.md", address: "project://正文/第二章.md", icon: "markdown"},
];

/** 组件注入的窗口端口；断言里的界面文字经它从目录取，不在测试里重复写一份。 */
const port = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});
const shown = (key: EditorTextKey): string => port.t(editorText(key));

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function crumbs(extra: {outline?: EditorOutline | null; segments?: BreadcrumbSegment[]} = {}) {
    const calls: Array<{address: string; signal: AbortSignal; resolve: (value: BreadcrumbListing) => void}> = [];
    const list = (address: string, signal: AbortSignal) => new Promise<BreadcrumbListing>((resolve) => calls.push({address, signal, resolve}));
    const wrapper = mount(EditorBreadcrumbs, {props: {segments: extra.segments ?? SEGMENTS, parent: "project://正文", outline: extra.outline ?? null, list}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, calls};
}

const segment = (wrapper: ReturnType<typeof crumbs>["wrapper"], kind: string) => wrapper.get(`[data-breadcrumb-segment="${kind}"]`);
const items = () => [...document.body.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => item.textContent?.trim() ?? "");
const item = (label: string) => [...document.body.querySelectorAll<HTMLElement>("[role^=menuitem]")].find((candidate) => candidate.textContent?.trim() === label);
const open = async (wrapper: ReturnType<typeof crumbs>["wrapper"], kind: string) => {
    await segment(wrapper, kind).trigger("keydown", {key: "ArrowDown"});
    await flushPromises();
};

describe("EditorBreadcrumbs", () => {
    it("根 › 目录 › 文件；没有段时不渲染", () => {
        const {wrapper} = crumbs();
        expect(wrapper.findAll("[data-breadcrumb-segment]").map((node) => [node.attributes("data-breadcrumb-segment"), node.text()])).toEqual([["root", "长夜"], ["dir", "正文"], ["file", "第二章.md"]]);
        const empty = crumbs({segments: []});
        expect(empty.wrapper.find("[data-editor-breadcrumbs]").exists()).toBe(false);
    });

    it("目录下拉：读取中一行，回来后列出子项；点目录进下一层（下拉不关），点文件交出 open；链接与缺失的项不可选", async () => {
        const {wrapper, calls} = crumbs();
        await open(wrapper, "dir");
        expect(items()).toEqual([shown("crumbs.loading")]);
        expect(calls.map((call) => call.address)).toEqual(["project://正文"]);
        calls[0]?.resolve({ok: true, entries: [{name: "卷一", address: "project://正文/卷一", kind: "directory"}, {name: "第一章.md", address: "project://正文/第一章.md", kind: "file"}, {name: "旧稿", address: "project://正文/旧稿", kind: "missing"}]});
        await flushPromises();
        expect(items()).toEqual(["卷一", "第一章.md", "旧稿"]);
        expect(item("旧稿")?.getAttribute("data-disabled")).not.toBeNull();
        item("卷一")?.click();
        await flushPromises();
        expect(calls.map((call) => call.address)).toEqual(["project://正文", "project://正文/卷一"]);
        expect(items()).toEqual([shown("crumbs.loading")]);
        calls[1]?.resolve({ok: true, entries: [{name: "第三章.md", address: "project://正文/卷一/第三章.md", kind: "file"}]});
        await flushPromises();
        item("第三章.md")?.click();
        await flushPromises();
        expect(wrapper.emitted("open")).toEqual([["project://正文/卷一/第三章.md"]]);
        expect(items()).toEqual([]);
    });

    it("文件段列同级、当前文件打勾；失败给原因与重试；关上后迟到的结果丢掉，在途读取被中止", async () => {
        const {wrapper, calls} = crumbs();
        await open(wrapper, "file");
        expect(calls.map((call) => call.address)).toEqual(["project://正文"]);
        calls[0]?.resolve({ok: false, reason: "读不了这个目录"});
        await flushPromises();
        expect(items()).toEqual(["读不了这个目录", shown("crumbs.retry")]);
        item(shown("crumbs.retry"))?.click();
        await flushPromises();
        expect(calls).toHaveLength(2);
        calls[1]?.resolve({ok: true, entries: [{name: "第一章.md", address: "project://正文/第一章.md", kind: "file"}, {name: "第二章.md", address: "project://正文/第二章.md", kind: "file"}]});
        await flushPromises();
        expect(item("第二章.md")?.getAttribute("aria-checked")).toBe("true");

        await segment(wrapper, "file").trigger("keydown", {key: "Escape"});
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await flushPromises();
        await open(wrapper, "root");
        const rootCall = calls[2];
        await wrapper.setProps({segments: [SEGMENTS[0] as BreadcrumbSegment, {kind: "file", label: "序.md", address: "project://序.md", icon: "markdown"}]});
        await nextTick();
        expect(rootCall?.signal.aborted).toBe(true);
        rootCall?.resolve({ok: true, entries: [{name: "迟到.md", address: "project://迟到.md", kind: "file"}]});
        await flushPromises();
        expect(items()).not.toContain("迟到.md");
    });

    it("标题段：列出大纲、当前打勾；选中交出打开时的 binding 与 version；大纲身份变了下拉关上", async () => {
        const outline: EditorOutline = {binding: "v1", version: 3, items: [{id: "h0", level: 1, text: "第二章"}, {id: "h1", level: 2, text: "雨夜"}], current: "h1"};
        const {wrapper} = crumbs({outline});
        expect(segment(wrapper, "heading").text()).toBe("雨夜");
        await open(wrapper, "heading");
        expect(items()).toEqual(["第二章", "雨夜"]);
        // 二级标题缩进一个全角空格。
        expect(item("雨夜")?.textContent?.includes("\u3000雨夜")).toBe(true);
        expect(item("雨夜")?.getAttribute("aria-checked")).toBe("true");
        item("第二章")?.click();
        await flushPromises();
        expect(wrapper.emitted("reveal")).toEqual([["v1", 3, "h0"]]);

        await open(wrapper, "heading");
        await wrapper.setProps({outline: {...outline, version: 4}});
        await flushPromises();
        expect(items()).toEqual([]);
    });

    it("←/→ 换段；下拉关着时 Escape 交出 escape；focusSeq 变了聚焦最后一段", async () => {
        const {wrapper} = crumbs();
        await segment(wrapper, "file").trigger("keydown", {key: "ArrowLeft"});
        await nextTick();
        expect(document.activeElement?.getAttribute("data-breadcrumb-segment")).toBe("dir");
        await segment(wrapper, "dir").trigger("keydown", {key: "Escape"});
        expect(wrapper.emitted("escape")).toHaveLength(1);
        await wrapper.setProps({focusSeq: 1});
        await nextTick();
        expect(document.activeElement?.getAttribute("data-breadcrumb-segment")).toBe("file");
        // 卸下（宿主用 v-if 关掉面包屑）时焦点在里面：交出 escape，宿主把焦点还给编辑器。
        let escapes = 0;
        const visible = ref(true);
        const host = mount(defineComponent({setup: () => () => (visible.value ? h(EditorBreadcrumbs, {segments: SEGMENTS, parent: null, outline: null, list: async () => ({ok: true as const, entries: []}), onEscape: () => {
            escapes += 1;
        }}) : null)}), {global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(host);
        (host.get("[data-breadcrumb-segment=\"root\"]").element as HTMLElement).focus();
        visible.value = false;
        await nextTick();
        expect(escapes).toBe(1);
    });
});
