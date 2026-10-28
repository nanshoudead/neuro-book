/**
 * WelcomePage（同名 .md）：统计行与书卡同一写法、快捷入口与最近打开的写法、至多 5 个最近打开、没有绑定项目时只给回到
 * 书架、各入口发出的事件、命令面板快捷键拆成按键。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ShelfStats} from "../../shared/contracts";
import {projectsCatalogs} from "../text";
import WelcomePage from "./WelcomePage.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const NOW = "2026-10-12T16:30:00+01:00";
const STALE: ShelfStats = {freshness: "stale", computedAt: "2026-10-12T09:05:00+01:00", words: 174, files: 5, unreadable: 0, today: null, last: null};

function page(props: Record<string, unknown> = {}) {
    return mount(WelcomePage, {global, props: {
        title: "雾港",
        description: null,
        stats: STALE,
        now: NOW,
        quick: [{address: "project://大纲.md", name: "大纲.md", kind: "file"}, {address: "project://设定", name: "设定", kind: "folder"}],
        recent: ["project://正文/第一卷/第一章.md", "project://大纲.md", "project://a.md", "project://b.md", "project://c.md", "project://d.md"],
        shortcut: "Ctrl+Shift+P",
        ...props,
    }});
}

describe("WelcomePage", () => {
    it("概况：书名、没有简介时的说明、字数 · 篇数 · 统计于……；还没统计写“尚未统计”，没取到统计不显示这一行", async () => {
        const wrapper = page();
        expect(wrapper.get("[data-welcome-title]").text()).toBe("雾港");
        expect(wrapper.get("[data-welcome-description]").text()).toBe("还没有简介");
        expect(wrapper.get("[data-welcome-stats]").text()).toMatch(/^174 字 · 5 篇 · 统计于今天 \d\d:\d\d$/u);
        await wrapper.setProps({stats: {...STALE, freshness: "none"}});
        expect(wrapper.get("[data-welcome-stats]").text()).toBe("尚未统计");
        await wrapper.setProps({stats: null, description: "雾港旧事"});
        expect(wrapper.find("[data-welcome-stats]").exists()).toBe(false);
        expect(wrapper.get("[data-welcome-description]").text()).toBe("雾港旧事");
    });

    it("开始与最近打开：入口的写法与事件；最近打开至多 5 个，写出所在目录；入门第二条带拆开的快捷键", async () => {
        const wrapper = page();
        expect(wrapper.findAll("[data-welcome-quick]").map((item) => item.text())).toEqual(["打开大纲", "打开设定"]);
        expect(wrapper.text()).toContain("设定/");
        const recent = wrapper.findAll("[data-welcome-recent]");
        expect(recent.map((item) => item.text())).toEqual(["第一章.md", "大纲.md", "a.md", "b.md", "c.md"]);
        expect(recent[0]!.element.parentElement?.textContent).toContain("正文/第一卷");
        expect(wrapper.findAll("kbd").map((key) => key.text())).toEqual(["Ctrl", "Shift", "P"]);

        await wrapper.get("[data-welcome-new-chapter]").trigger("click");
        await wrapper.get("[data-welcome-quick=\"project://大纲.md\"]").trigger("click");
        await wrapper.get("[data-welcome-quick=\"project://设定\"]").trigger("click");
        await recent[1]!.trigger("click");
        await wrapper.get("[data-welcome-shelf]").trigger("click");
        expect(wrapper.emitted("new-chapter")).toHaveLength(1);
        expect(wrapper.emitted("open")).toEqual([["project://大纲.md"], ["project://大纲.md"]]);
        expect(wrapper.emitted("reveal")).toEqual([["project://设定"]]);
        expect(wrapper.emitted("shelf")).toHaveLength(1);

        await wrapper.setProps({recent: [], shortcut: null, problem: "新建章节失败：permission-denied"});
        expect(wrapper.find("[data-welcome-no-recent]").text()).toBe("还没有打开过文件");
        expect(wrapper.findAll("kbd")).toHaveLength(0);
        expect(wrapper.get("[role=alert]").text()).toBe("新建章节失败：permission-denied");
    });

    it("没有绑定项目：只写“没有打开作品”与回到书架", async () => {
        const wrapper = page({title: null});
        expect(wrapper.get("h1").text()).toBe("没有打开作品");
        expect(wrapper.find("[data-welcome-new-chapter]").exists()).toBe(false);
        await wrapper.get("[data-welcome-shelf]").trigger("click");
        expect(wrapper.emitted("shelf")).toHaveLength(1);
    });
});
