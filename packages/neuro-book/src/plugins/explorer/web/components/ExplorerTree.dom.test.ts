/**
 * ExplorerTree 与 ExplorerRow（同名 .md）：树与行的 ARIA、虚拟窗口里焦点行保持挂载、按键只在树本身上交给宿主、点击与
 * 右键的事件。行数据由真实的投影（`tree/rows.ts`）从 Files 合同形状的列出结果算出。happy-dom 没有布局：这里只看
 * 渲染了哪些行与属性，真实滚动与几何由 e2e 验证。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {KeyOutcome} from "../controller";
import type {TreeKey} from "../tree/keys";
import type {DirectorySlot, RootState} from "../tree/model";
import {projectRows} from "../tree/rows";
import {explorerCatalogs} from "../text";
import ExplorerTree from "./ExplorerTree.vue";

const ROOTS: RootState[] = [
    {scheme: "project", address: "project://", status: {kind: "live"}},
    {scheme: "user", address: "user://", status: {kind: "live"}},
];

const port = testTextPort("zh-CN", {"nbook.explorer": explorerCatalogs});

const loaded = (listing: Listing): DirectorySlot => ({listing, error: null, loading: false, stale: false});
const file = (name: string): DirectoryEntry => ({name, kind: "file"});

function rowsOf(count: number, extra: Array<[string, DirectorySlot]> = [], expanded: string[] = []) {
    const entries: DirectoryEntry[] = [{name: "lore.content", kind: "directory", folder: "content"}, {name: "broken", kind: "directory"}, ...Array.from({length: count}, (_, index) => file(`chapter-${String(index).padStart(4, "0")}.md`))];
    const slots = new Map<string, DirectorySlot>([["project://", loaded({folder: "plain", contentRoot: null, entries})], ...extra]);
    return projectRows({roots: ROOTS, slots, expanded: new Set(["project://", ...expanded]), showManifests: false});
}

const keys: TreeKey[] = [];
const handleKey = (key: TreeKey): KeyOutcome => {
    keys.push(key);
    if (key.key === "ContextMenu") return {menu: "project://chapter-0001.md"};
    return key.key === "ArrowDown" ? "handled" : "none";
};

function tree(props: Partial<{rows: ReturnType<typeof rowsOf>; selected: string[]; focus: string | null; indentGuides: "none" | "hover" | "always"; hideMarkdownExtension: boolean}> = {}) {
    return mount(ExplorerTree, {props: {rows: props.rows ?? rowsOf(3), selected: props.selected ?? [], focus: props.focus ?? null, label: "文件", handleKey, ...(props.indentGuides === undefined ? {} : {indentGuides: props.indentGuides}), ...(props.hideMarkdownExtension === undefined ? {} : {hideMarkdownExtension: props.hideMarkdownExtension})}, attachTo: document.body, global: {provide: provideText(port)}});
}

describe("ExplorerTree", () => {
    it("树与行的角色和属性：多选树、层级、同层位置与总数、选中、可展开；读取失败挂在目录行上，原因在可访问描述与重试按钮的名称里", () => {
        const rows = rowsOf(3, [["project://broken", {listing: null, error: {code: "permission-denied", detail: "没有权限"}, loading: false, stale: false}]], ["project://broken"]);
        const wrapper = tree({rows, selected: ["project://chapter-0001.md"]});
        const root = wrapper.get("[role=tree]");
        expect(root.attributes()).toMatchObject({"aria-multiselectable": "true", "aria-label": "文件", tabindex: "0"});
        const item = wrapper.get("[data-explorer-row=\"project://chapter-0001.md\"]");
        expect(item.attributes()).toMatchObject({role: "treeitem", "aria-level": "2", "aria-posinset": "4", "aria-setsize": "5", "aria-selected": "true"});
        expect(item.attributes("aria-expanded")).toBeUndefined();
        expect(wrapper.get("[data-explorer-row=\"project://broken\"]").attributes("aria-expanded")).toBe("true");
        expect(wrapper.get("[data-explorer-row=\"project://\"]").attributes()).toMatchObject({"aria-level": "1", "aria-expanded": "true"});
        const broken = wrapper.get("[data-explorer-row=\"project://broken\"]");
        expect(broken.attributes("data-explorer-problem")).toBe("error");
        expect(broken.attributes("aria-description")).toContain("读取失败：没有权限");
        expect(broken.get("[data-explorer-retry]").attributes("aria-label")).toContain("读取失败：没有权限");
        expect(wrapper.findAll("[role=none]")).toEqual([]);
        wrapper.unmount();
    });

    it("缩进参考线：每行画到上一层（根的子项不画），焦点行连续的同层兄弟加深上级那一层；档位写在树上；隐藏 .md 只改显示", () => {
        const nested = (name: string): DirectoryEntry => ({name, kind: "directory"});
        const slots: Array<[string, DirectorySlot]> = [
            ["project://broken", loaded({folder: "plain", contentRoot: null, entries: [nested("sub"), file("a.md"), file("b.md")]})],
            ["project://broken/sub", loaded({folder: "plain", contentRoot: null, entries: [file("deep.md")]})],
        ];
        const rows = rowsOf(1, slots, ["project://broken", "project://broken/sub"]);
        const wrapper = tree({rows, focus: "project://broken/a.md", indentGuides: "always", hideMarkdownExtension: true});
        expect(wrapper.get("[role=tree]").attributes("data-guides")).toBe("always");
        const guidesOf = (id: string) => wrapper.get(`[data-explorer-row="${id}"]`).findAll(".explorer-guide");
        expect(guidesOf("project://broken")).toHaveLength(0);
        expect(guidesOf("project://broken/a.md")).toHaveLength(1);
        expect(guidesOf("project://broken/sub/deep.md")).toHaveLength(2);
        // a.md 的同层兄弟（含 sub 与夹在中间的 deep.md）加深第 1 层；别的层不加深。
        for (const id of ["project://broken/sub", "project://broken/sub/deep.md", "project://broken/a.md", "project://broken/b.md"]) {
            expect(guidesOf(id)[0]?.attributes("data-guide-active")).toBe("");
        }
        expect(guidesOf("project://broken/sub/deep.md")[1]?.attributes("data-guide-active")).toBeUndefined();
        expect(wrapper.get("[data-explorer-row=\"project://broken/a.md\"] [data-explorer-label]").text()).toBe("a");
        expect(wrapper.get("[data-explorer-row=\"project://broken/a.md\"]").attributes("title")).toBe("project://broken/a.md");
        wrapper.unmount();
        const plainTree = tree();
        expect(plainTree.get("[role=tree]").attributes("data-guides")).toBe("hover");
        plainTree.unmount();
    });

    it("几千行只渲染视口附近；远处的焦点行也保持挂载，aria-activedescendant 指向现存的元素", () => {
        const rows = rowsOf(3000);
        const far = "project://chapter-2500.md";
        const wrapper = tree({rows, focus: far, selected: [far]});
        const rendered = wrapper.findAll("[role=treeitem]");
        expect(rendered.length).toBeLessThan(60);
        expect(rendered.length).toBeGreaterThan(10);
        const target = wrapper.get("[role=tree]").attributes("aria-activedescendant");
        expect(target).toBeDefined();
        expect(document.getElementById(target as string)?.getAttribute("data-explorer-row")).toBe(far);
        wrapper.unmount();
    });

    it("按键：树本身上的按键交给宿主，宿主处理了才阻止默认行为；行里按钮上的按键不交", async () => {
        keys.length = 0;
        const rows = rowsOf(3, [["project://broken", {listing: null, error: {code: "io-failed", detail: "坏了"}, loading: false, stale: false}]], ["project://broken"]);
        const wrapper = tree({rows});
        const root = wrapper.get("[role=tree]");
        const down = new KeyboardEvent("keydown", {key: "ArrowDown", ctrlKey: true, cancelable: true, bubbles: true});
        root.element.dispatchEvent(down);
        const other = new KeyboardEvent("keydown", {key: "x", cancelable: true, bubbles: true});
        root.element.dispatchEvent(other);
        expect(keys).toEqual([{key: "ArrowDown", shift: false, toggle: true, alt: false}, {key: "x", shift: false, toggle: false, alt: false}]);
        expect(down.defaultPrevented).toBe(true);
        expect(other.defaultPrevented).toBe(false);
        await wrapper.get("[data-explorer-retry]").trigger("keydown", {key: "ArrowDown"});
        expect(keys).toHaveLength(2);
        await wrapper.get("[data-explorer-retry]").trigger("click");
        expect(wrapper.emitted("retry")).toEqual([["project://broken"]]);
        // 宿主要在某一行开菜单：按那一行的位置发出 row-context。
        const menu = new KeyboardEvent("keydown", {key: "ContextMenu", cancelable: true, bubbles: true});
        root.element.dispatchEvent(menu);
        expect(menu.defaultPrevented).toBe(true);
        expect(wrapper.emitted("row-context")).toEqual([["project://chapter-0001.md", expect.any(Number), expect.any(Number)]]);
        wrapper.unmount();
    });

    it("点击带修饰键、展开箭头、双击与右键各自发出；按下行把焦点放到树上，焦点进出发出 focus-change", async () => {
        const rows = rowsOf(3);
        const wrapper = tree({rows});
        const row = wrapper.get("[data-explorer-row=\"project://chapter-0000.md\"]");
        await row.trigger("click", {ctrlKey: true});
        await row.trigger("click", {shiftKey: true});
        await wrapper.get("[data-explorer-row=\"project://lore.content\"] [data-explorer-twisty]").trigger("click");
        await row.trigger("dblclick");
        await row.trigger("contextmenu", {clientX: 12, clientY: 34});
        expect(wrapper.emitted("row-press")).toEqual([
            ["project://chapter-0000.md", {toggle: true, range: false}, "row"],
            ["project://chapter-0000.md", {toggle: false, range: true}, "row"],
            ["project://lore.content", {toggle: false, range: false}, "twisty"],
        ]);
        expect(wrapper.emitted("row-activate")).toEqual([["project://chapter-0000.md"]]);
        expect(wrapper.emitted("row-context")).toEqual([["project://chapter-0000.md", 12, 34]]);
        expect(document.activeElement).toBe(wrapper.get("[role=tree]").element);
        expect(wrapper.emitted("focus-change")).toEqual([[true]]);
        (wrapper.get("[role=tree]").element as HTMLElement).blur();
        expect(wrapper.emitted("focus-change")).toEqual([[true], [false]]);
        wrapper.unmount();
    });

    it("焦点框只在树拥有焦点时画在焦点行上", async () => {
        const wrapper = tree({focus: "project://chapter-0000.md"});
        const row = () => wrapper.get("[data-explorer-row=\"project://chapter-0000.md\"]");
        expect(row().attributes("data-active")).toBeUndefined();
        (wrapper.get("[role=tree]").element as HTMLElement).focus();
        await wrapper.vm.$nextTick();
        expect(row().attributes("data-active")).toBe("true");
        wrapper.unmount();
    });
});
