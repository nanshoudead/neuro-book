/**
 * FileBrowser（同名 .md）：单击选中、双击或回车进入目录、面包屑与“..”回上级、Backspace 回上级、禁用项跳过；换目录后失效的选中清掉。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import FileBrowser from "./FileBrowser.vue";
import type {FileBrowserEntry} from "./FileBrowser.vue";

const segments = [{label: "/", path: "/"}, {label: "home", path: "/home"}, {label: "books", path: "/home/books"}];
const entries: FileBrowserEntry[] = [
    {id: "/home/books/a", name: "a", kind: "directory"},
    {id: "/home/books/b", name: "b", kind: "directory", badge: "已在书架上", disabled: true},
    {id: "/home/books/c", name: "c", kind: "directory"},
    {id: "/home/books/notes.md", name: "notes.md", kind: "file"},
];

function mountBrowser(selectedId: string | null = null) {
    return mount(FileBrowser, {props: {segments, entries, selectedId}});
}

describe("FileBrowser", () => {
    it("单击选中；上下方向键跳过禁用项；Home、End 到两端", async () => {
        const wrapper = mountBrowser();
        await wrapper.get("[data-file-browser-entry='/home/books/a']").trigger("click");
        expect(wrapper.emitted("update:selectedId")?.at(-1)).toEqual(["/home/books/a"]);
        await wrapper.setProps({selectedId: "/home/books/a"});
        await wrapper.get("[role='listbox']").trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.emitted("update:selectedId")?.at(-1)).toEqual(["/home/books/c"]);
        await wrapper.get("[role='listbox']").trigger("keydown", {key: "End"});
        expect(wrapper.emitted("update:selectedId")?.at(-1)).toEqual(["/home/books/notes.md"]);
        await wrapper.get("[role='listbox']").trigger("keydown", {key: "Home"});
        expect(wrapper.emitted("update:selectedId")?.at(-1)).toEqual(["/home/books/a"]);
    });

    it("双击或回车：目录进入（navigate），文件激活（activate）；禁用项都不发", async () => {
        const wrapper = mountBrowser("/home/books/a");
        await wrapper.get("[role='listbox']").trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("navigate")).toEqual([["/home/books/a"]]);
        await wrapper.get("[data-file-browser-entry='/home/books/notes.md']").trigger("dblclick");
        expect(wrapper.emitted("activate")).toEqual([["/home/books/notes.md"]]);
        await wrapper.get("[data-file-browser-entry='/home/books/b']").trigger("dblclick");
        expect(wrapper.emitted("navigate")).toHaveLength(1);
    });

    it("面包屑的一段发 navigate；“..”与 Backspace 发 up；只有一段时没有“..”", async () => {
        const wrapper = mountBrowser();
        const crumb = wrapper.findAll("nav a").find((link) => link.text() === "home");
        await crumb?.trigger("click");
        expect(wrapper.emitted("navigate")).toEqual([["/home"]]);
        await wrapper.get("[data-file-browser-up]").trigger("click");
        await wrapper.get("[role='listbox']").trigger("keydown", {key: "Backspace"});
        expect(wrapper.emitted("up")).toHaveLength(2);
        // 重名的段按位置区分：点第二个 src 回到 /src/src，不是 /src。
        const nested = mount(FileBrowser, {props: {segments: [{label: "/", path: "/"}, {label: "src", path: "/src"}, {label: "src", path: "/src/src"}, {label: "app", path: "/src/src/app"}], entries: [], selectedId: null}});
        await nested.findAll("nav a").filter((link) => link.text() === "src")[1]?.trigger("click");
        expect(nested.emitted("navigate")).toEqual([["/src/src"]]);
        const root = mount(FileBrowser, {props: {segments: [segments[0]!], entries: [], selectedId: null}});
        expect(root.find("[data-file-browser-up]").exists()).toBe(false);
        expect(root.find("[data-file-browser-empty]").exists()).toBe(true);
    });

    it("换了目录后不在列表里的选中项清掉；加载中与出错各自显示", async () => {
        const wrapper = mountBrowser("/home/books/a");
        await wrapper.setProps({entries: [{id: "/x", name: "x", kind: "directory"}]});
        expect(wrapper.emitted("update:selectedId")?.at(-1)).toEqual([null]);
        await wrapper.setProps({loading: true});
        expect(wrapper.find("[data-file-browser-loading]").exists()).toBe(true);
        await wrapper.setProps({loading: false, error: "目录不可读"});
        expect(wrapper.get("[data-file-browser-error]").text()).toBe("目录不可读");
    });
});
