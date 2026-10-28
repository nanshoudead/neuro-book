/**
 * HTML 预览控件的说明文字（同名 .md）：令牌申请失败的三种说明与“不是作品里的文件”，中英文各一遍。令牌服务是按
 * `PreviewAccess` 接口写的内存实现，页面渲染与沙箱由 `e2e/editor-types.e2e.ts` 验收。
 */

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {computed, ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import type {TextEditorBinding} from "nbook/plugins/editor/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {PreviewAccess, PreviewDenial} from "../access";
import {htmlPreviewCatalogs} from "../text";
import HtmlPreview from "./HtmlPreview.vue";

const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function binding(address: string): TextEditorBinding {
    return {kind: "text", token: "t", tabId: "tab", editor: "nbook.html-preview.html", address: computed(() => address), text: ref("<p>x</p>"), revision: ref(1), slot: {state: null, dispose: null}, commit: () => ({status: "stale"}), attach: () => () => undefined, unresolved: () => false, block: () => undefined, blocked: () => false, cursor: null, remember: () => undefined, language: computed(() => null)};
}

/** 总是被拒绝的令牌服务。 */
const denying = (denial: PreviewDenial): PreviewAccess => ({open: async () => ({ok: false, denial}), close: () => undefined});

async function show(address: string, denial: PreviewDenial, locale: DisplayLocale): Promise<VueWrapper> {
    const wrapper = mount(HtmlPreview, {
        props: {binding: binding(address), host: {state: null, dispose: null}, readonly: true, visible: true, label: "index.html", access: denying(denial), clock: systemClock, network: () => true},
        global: {provide: provideText(testTextPort(locale, {"nbook.html-preview": htmlPreviewCatalogs}))},
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe("HtmlPreview 的说明文字", () => {
    it.each([
        ["no-project", "这个窗口没有打开作品，预览读不到文件。"],
        ["closed", "作品已经关闭，预览读不到它的文件。"],
        ["unreachable", "暂时连不上服务端，预览打不开。"],
    ] as const)("令牌申请被拒绝（%s）：说明原因并带“重试”", async (denial, message) => {
        const wrapper = await show("project://site/index.html", denial, "zh-CN");
        const failure = wrapper.get("[data-html-preview-failure]");
        expect(failure.get("p").text()).toBe(message);
        expect(failure.get("button").text()).toBe("重试");
    });

    it("不是作品里的文件：只有说明，没有“重试”", async () => {
        const wrapper = await show("user://notes/page.html", "closed", "zh-CN");
        const failure = wrapper.get("[data-html-preview-failure]");
        expect(failure.get("p").text()).toBe("只能预览作品里的文件。");
        expect(failure.find("button").exists()).toBe(false);
    });

    it("英文界面：说明与按钮都是英文", async () => {
        const wrapper = await show("project://site/index.html", "unreachable", "en-US");
        const failure = wrapper.get("[data-html-preview-failure]");
        expect(failure.get("p").text()).toBe("Cannot reach the server, so the preview cannot be opened.");
        expect(failure.get("button").text()).toBe("Retry");
    });
});
