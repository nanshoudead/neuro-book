/** ShelfCards（同名 .md）：网格的键盘与选中（docs/specs/workbench/bookshelf.md 输出 6）；空书架的两张卡。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ShelfItem} from "../../shared/shelf";
import {projectsCatalogs} from "../text";
import ShelfCards from "./ShelfCards.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const NOW = "2026-10-11T12:00:00.000Z";

function item(id: string, title: string): ShelfItem {
    return {
        id, name: id, title, description: "简介", color: null, cover: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
    };
}

function mountCards(items: ShelfItem[], activeId: string | null = null) {
    return mount(ShelfCards, {global, props: {items, activeId, now: NOW, coverSrc: () => null, library: "/home/writer/Documents/NeuroBook"}, attachTo: document.body});
}

describe("ShelfCards", () => {
    it("方向键移动选中、End 到末尾占位、Enter 打开、Delete 请求移出；聚焦时没有选中就选第一部；点卡片选中并打开", async () => {
        const wrapper = mountCards([item("a", "甲"), item("b", "乙"), item("c", "丙")]);
        const grid = wrapper.get("[role='listbox']");
        await grid.trigger("focus");
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["a"]);
        await wrapper.setProps({activeId: "a"});
        await grid.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["b"]);
        // End 到最后一个选项，即末尾的“新建作品”占位；再左移回到最后一部作品。
        await grid.trigger("keydown", {key: "End"});
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["b"]);
        await grid.trigger("keydown", {key: "ArrowLeft"});
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["c"]);
        await grid.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("open")).toEqual([["a"]]);
        await grid.trigger("keydown", {key: "Delete"});
        expect(wrapper.emitted("remove")).toEqual([["a"]]);
        await wrapper.get("[data-book-card='c']").trigger("click");
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["c"]);
        expect(wrapper.emitted("open")?.at(-1)).toEqual(["c"]);
        expect(wrapper.get("[data-book-card='a']").attributes("aria-selected")).toBe("true");
        wrapper.unmount();
    });

    it("末尾的“新建作品”占位是列表框的最后一个选项：End 与方向键走得到，回车发 create，不改选中；点它发 create", async () => {
        const wrapper = mountCards([item("a", "甲"), item("b", "乙")], "b");
        const grid = wrapper.get("[role='listbox']");
        const placeholder = wrapper.get("[data-shelf-create-card]");
        expect(placeholder.attributes("role")).toBe("option");
        expect(placeholder.attributes("aria-selected")).toBe("false");
        await grid.trigger("keydown", {key: "End"});
        expect(grid.attributes("aria-activedescendant")).toBe(placeholder.attributes("id"));
        expect(wrapper.emitted("update:activeId")).toBeUndefined();
        // 选中不变，只是环挪到占位上。
        expect(wrapper.get("[data-book-card='b']").attributes("aria-selected")).toBe("true");
        expect(wrapper.get("[data-book-card='b']").classes()).not.toContain("book-card--active");
        expect(placeholder.classes()).toContain("shelf-ghost--active");
        await grid.trigger("keydown", {key: "Delete"});
        expect(wrapper.emitted("remove")).toBeUndefined();
        await grid.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("create")).toEqual([[]]);
        expect(wrapper.emitted("open")).toBeUndefined();
        await grid.trigger("keydown", {key: "ArrowLeft"});
        expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["b"]);
        await placeholder.trigger("click");
        expect(wrapper.emitted("create")).toHaveLength(2);
        expect(placeholder.text()).toContain("/home/writer/Documents/NeuroBook");
        wrapper.unmount();
    });

    it("空书架：两张待写的书，写明作品目录；点它们发 create 与 add-existing", async () => {
        const wrapper = mountCards([]);
        expect(wrapper.find("[role='listbox']").exists()).toBe(false);
        expect(wrapper.get("[data-shelf-empty]").text()).toContain("/home/writer/Documents/NeuroBook");
        await wrapper.get("[data-shelf-create]").trigger("click");
        await wrapper.get("[data-shelf-add]").trigger("click");
        expect(wrapper.emitted("create")).toHaveLength(1);
        expect(wrapper.emitted("add-existing")).toHaveLength(1);
        wrapper.unmount();
    });
});
