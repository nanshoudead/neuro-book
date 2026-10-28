/**
 * PathPickerDialog（同名 .md）：打开时列起点目录，进入与回上级重新列，选作品模式下已在书架上的不能选、双击作品目录就是确认，
 * 选目录模式下没选条目时确认交出当前目录；输入路径回车进入；宿主给的错误显示出来。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {BrowseEntry} from "../../shared/contracts";
import {projectsCatalogs} from "../text";
import PathPickerDialog from "./PathPickerDialog.vue";
import type {PathPickerSource} from "./PathPickerDialog.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const TREE: Record<string, {parent: string | null; entries: BrowseEntry[]}> = {
    "/home/writer/Documents/NeuroBook": {parent: "/home/writer/Documents", entries: [
        {name: "beifang", path: "/home/writer/Documents/NeuroBook/beifang", kind: "project", title: "北方以北"},
        {name: "changyexing", path: "/home/writer/Documents/NeuroBook/changyexing", kind: "registered", title: null},
        {name: "drafts", path: "/home/writer/Documents/NeuroBook/drafts", kind: "directory", title: null},
    ]},
    "/home/writer/Documents/NeuroBook/drafts": {parent: "/home/writer/Documents/NeuroBook", entries: []},
    "/home/writer/Documents": {parent: "/home/writer", entries: [{name: "NeuroBook", path: "/home/writer/Documents/NeuroBook", kind: "directory", title: null}]},
};

function source(listed: string[] = []): PathPickerSource {
    return {
        list: async (path) => {
            const key = path ?? "/home/writer/Documents/NeuroBook";
            listed.push(key);
            const node = TREE[key];
            return node === undefined ? {ok: false, message: `列不出目录：${key}`} : {ok: true, value: {path: key, ...node}};
        },
    };
}

function open(mode: "project" | "directory", listed: string[] = [], extra: Record<string, unknown> = {}) {
    const wrapper = mount(PathPickerDialog, {global, props: {open: true, mode, source: source(listed), ...extra}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

describe("PathPickerDialog", () => {
    it("选作品：打开时列作品目录，已在书架上的不能选；选中作品后“加入书架”交出路径；双击作品目录直接确认", async () => {
        const listed: string[] = [];
        const wrapper = open("project", listed);
        await flushPromises();
        expect(listed).toEqual(["/home/writer/Documents/NeuroBook"]);
        expect(query("[data-file-browser-entry='/home/writer/Documents/NeuroBook/changyexing']").getAttribute("aria-disabled")).toBe("true");
        expect(query<HTMLButtonElement>("[data-path-picker-confirm]").disabled).toBe(true);
        query<HTMLElement>("[data-file-browser-entry='/home/writer/Documents/NeuroBook/beifang']").click();
        await flushPromises();
        expect(query("[data-path-picker-summary]").textContent).toContain("北方以北");
        query<HTMLButtonElement>("[data-path-picker-confirm]").click();
        expect(wrapper.emitted("pick")).toEqual([["/home/writer/Documents/NeuroBook/beifang"]]);
        query<HTMLElement>("[data-file-browser-entry='/home/writer/Documents/NeuroBook/beifang']").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        await flushPromises();
        expect(wrapper.emitted("pick")).toHaveLength(2);
    });

    it("进入普通目录与回上级重新列；选目录模式下没选条目时确认交出当前目录；输入路径回车进入；列失败显示原因", async () => {
        const listed: string[] = [];
        const wrapper = open("directory", listed, {initialPath: "/home/writer/Documents/NeuroBook"});
        await flushPromises();
        query<HTMLElement>("[data-file-browser-entry='/home/writer/Documents/NeuroBook/drafts']").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        await flushPromises();
        expect(listed.at(-1)).toBe("/home/writer/Documents/NeuroBook/drafts");
        expect(document.body.querySelector("[data-file-browser-empty]")).not.toBeNull();
        query<HTMLButtonElement>("[data-path-picker-confirm]").click();
        expect(wrapper.emitted("pick")).toEqual([["/home/writer/Documents/NeuroBook/drafts"]]);
        query<HTMLElement>("[data-file-browser-up]").click();
        await flushPromises();
        expect(listed.at(-1)).toBe("/home/writer/Documents/NeuroBook");

        query<HTMLButtonElement>("[data-path-picker-type]").click();
        await flushPromises();
        const input = query<HTMLInputElement>("[data-path-picker-input] input, input[data-path-picker-input]");
        input.value = "/home/writer/Documents";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(listed.at(-1)).toBe("/home/writer/Documents");

        query<HTMLElement>("[data-file-browser-entry='/home/writer/Documents/NeuroBook']").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        await flushPromises();
        await wrapper.setProps({error: "没有加入书架：路径无效或不存在"});
        // 原因写在页脚状态行，替下“已选 …”；浏览器下面不插字。
        expect(query("[data-dialog-status]").textContent).toContain("路径无效");
        expect(document.body.querySelector("[data-path-picker-summary]")).toBeNull();

        query<HTMLButtonElement>("[data-path-picker-type]").click();
        await flushPromises();
        const again = query<HTMLInputElement>("[data-path-picker-input] input, input[data-path-picker-input]");
        again.value = "/nowhere";
        again.dispatchEvent(new Event("input", {bubbles: true}));
        again.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(query("[data-file-browser-error]").textContent).toContain("/nowhere");
    });
});
