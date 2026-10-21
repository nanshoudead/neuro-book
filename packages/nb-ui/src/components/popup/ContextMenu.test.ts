/** ContextMenu（同名 .md）的键盘：打开即聚焦首个可用项，方向键与 Home/End 在同级循环，子菜单的进出，Enter 选择。 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ContextMenu from "./ContextMenu.vue";
import type {ContextMenuItem} from "./context-menu.types";

const chosen: string[] = [];
const ITEMS: ContextMenuItem[] = [
    {label: "新建", action: () => chosen.push("新建")},
    {label: "禁用的", disabled: true},
    {separator: true},
    {label: "更多", children: [{label: "子一", action: () => chosen.push("子一")}, {label: "子二", action: () => chosen.push("子二")}]},
    {label: "删除", action: () => chosen.push("删除")},
];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    chosen.length = 0;
});

const focused = (): string | undefined => document.activeElement?.textContent?.trim();
/** 挂着高亮的项：普通按钮项的高亮跟着焦点走，任何时候最多一项。 */
const highlighted = (): (string | undefined)[] => Array.from(document.querySelectorAll("[data-highlighted]"), (item) => item.textContent?.trim());
const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    await flushPromises();
};

async function open() {
    const wrapper = mount(ContextMenu, {props: {visible: false, x: 10, y: 10, items: ITEMS}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    await wrapper.setProps({visible: true});
    await flushPromises();
    return wrapper;
}

describe("ContextMenu 键盘", () => {
    it("打开即聚焦首个可用项；上下方向键跳过禁用项与分隔线并循环；Home/End 到首末项", async () => {
        await open();
        expect(focused()).toBe("新建");
        expect(highlighted()).toEqual(["新建"]);
        await press("ArrowDown");
        expect(focused()).toBe("更多");
        expect(highlighted()).toEqual(["更多"]);
        await press("ArrowDown");
        expect(focused()).toBe("删除");
        await press("ArrowDown");
        expect(focused()).toBe("新建");
        await press("ArrowUp");
        expect(focused()).toBe("删除");
        await press("Home");
        expect(focused()).toBe("新建");
        await press("End");
        expect(focused()).toBe("删除");
    });

    it("ArrowRight 展开子菜单并聚焦它的第一项；ArrowLeft 收起并回到展开它的那一项；选择发出 close", async () => {
        const wrapper = await open();
        await press("ArrowDown");
        await press("ArrowRight");
        await flushPromises();
        expect(focused()).toBe("子一");
        await press("ArrowDown");
        expect(focused()).toBe("子二");
        await press("ArrowLeft");
        expect(focused()).toBe("更多");
        expect(document.querySelectorAll("[data-menu-level]")).toHaveLength(0);
        await press("End");
        (document.activeElement as HTMLButtonElement).click();
        expect(chosen).toEqual(["删除"]);
        expect(wrapper.emitted("close")).toEqual([["select"]]);
    });

    it("勾选项画成 menuitemcheckbox，aria-checked 跟着 checked，勾与快捷键同时显示；禁用项的 title 也是读屏描述", async () => {
        const wrapper = mount(ContextMenu, {props: {visible: true, x: 10, y: 10, items: [
            {label: "显示隐藏文件", type: "checkbox", checked: true, shortcut: "Ctrl+H", action: () => chosen.push("勾")},
            {label: "导出", disabled: true, title: "没有选中的章节"},
        ]}, attachTo: document.body});
        mounted.push(wrapper);
        await flushPromises();
        const items = Array.from(document.querySelectorAll<HTMLElement>("[role^=menuitem]"));
        expect(items.map((item) => [item.textContent?.trim(), item.getAttribute("role"), item.getAttribute("aria-checked"), item.getAttribute("aria-description")])).toEqual([
            ["显示隐藏文件Ctrl+H", "menuitemcheckbox", "true", null],
            ["导出", "menuitem", null, "没有选中的章节"],
        ]);
        expect(items[0]!.querySelector(".i-lucide-check")).not.toBeNull();
        expect(items[1]!.querySelector(".i-lucide-check")).toBeNull();
    });

    it("关闭原因：Tab（阻止默认的焦点移动）、Escape、菜单外点击各自带上", async () => {
        const wrapper = await open();
        const tab = new KeyboardEvent("keydown", {key: "Tab", shiftKey: true, bubbles: true, cancelable: true});
        document.activeElement?.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        await press("Escape");
        document.body.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(wrapper.emitted("close")).toEqual([["tab"], ["escape"], ["outside"]]);
    });
});
