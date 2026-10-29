/** ShelfList（同名 .md）：每行的字数、篇数与新鲜度说明（docs/specs/workbench/bookshelf.md 输出 8）；点行打开；末行新建。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ShelfItem} from "../../shared/shelf";
import {projectsCatalogs} from "../text";
import ShelfList from "./ShelfList.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const NOW = "2026-10-11T12:00:00.000Z";
const COUNTED_AT = "2026-10-10T09:00:00.000Z";

function item(id: string, freshness: ShelfItem["stats"]["freshness"], state: ShelfItem["state"] = "stopped"): ShelfItem {
    return {
        id, name: id, title: id, description: null, color: null, cover: null, path: `/books/${id}`, state,
        stats: {freshness, computedAt: freshness === "none" ? null : COUNTED_AT, words: 1200, files: 3, unreadable: 0, today: null, last: freshness === "none" ? null : {address: "project://a.md", label: "a", at: COUNTED_AT, excerpt: ""}},
    };
}

describe("ShelfList", () => {
    it("每行按新鲜度写说明：none 只写“尚未统计”，stale 写“统计于某时”，counting 写“正在统计”，fresh 不加；正在打开的加“已打开”", () => {
        const wrapper = mount(ShelfList, {global, props: {now: NOW, coverSrc: () => null, items: [item("none", "none"), item("stale", "stale"), item("counting", "counting"), item("fresh", "fresh", "running")]}});
        const rows = wrapper.findAll("[data-shelf-row]");
        expect(rows[0]!.find(".shelf-list__counts").text()).toBe("尚未统计");
        expect(rows[0]!.find(".shelf-list__when").text()).toBe("—");
        expect(rows[1]!.find(".shelf-list__when").text()).toMatch(/统计于/u);
        expect(rows[2]!.find(".shelf-list__when").text()).toContain("正在统计");
        expect(rows[3]!.find(".shelf-list__when").text()).not.toContain("统计");
        expect(rows[3]!.find(".shelf-list__when").text()).toContain("已打开");
        expect(rows[3]!.find("[data-book-cover-typo]").exists()).toBe(true);
        wrapper.unmount();
    });

    it("点行发 open；有封面地址时画图", async () => {
        const wrapper = mount(ShelfList, {global, props: {now: NOW, coverSrc: (entry: ShelfItem) => (entry.id === "a" ? "data:image/png;base64," : null), items: [item("a", "fresh")]}});
        await wrapper.get("[data-shelf-row] button").trigger("click");
        expect(wrapper.emitted("open")).toEqual([["a"]]);
        expect(wrapper.find("[data-book-cover] img").exists()).toBe(true);
        wrapper.unmount();
    });

    it("最后一行是“新建作品”：不算作品行，点它发 create", async () => {
        const wrapper = mount(ShelfList, {global, props: {now: NOW, coverSrc: () => null, items: [item("a", "fresh"), item("b", "fresh")]}});
        expect(wrapper.findAll("[data-shelf-row]")).toHaveLength(2);
        const create = wrapper.get("[data-shelf-create-row]");
        expect(create.text()).toContain("新建作品");
        await create.trigger("click");
        expect(wrapper.emitted("create")).toEqual([[]]);
        expect(wrapper.emitted("open")).toBeUndefined();
        wrapper.unmount();
    });
});
