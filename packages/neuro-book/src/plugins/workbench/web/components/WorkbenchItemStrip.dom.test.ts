/** WorkbenchItemStrip（同名 .md）：有命令的条目是按钮、没有的是状态文字；点击发 run；禁用带原因；没有条目时不画；名字里的标点随语言。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {nextTick} from "vue";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {workbenchTestText} from "../../testing/text";
import {workbenchCatalogs} from "../text";

import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";
import type {StripEntry} from "./WorkbenchItemStrip.vue";

function entry(id: string, text: string, extra: Partial<StripEntry> = {}): StripEntry {
    return {id, text, title: text, alignment: "right", order: 0, priority: 0, command: null, tooltip: null, state: "normal", disabledReason: null, ...extra};
}

describe("WorkbenchItemStrip", () => {
    it("有命令的条目是按钮，点击发 run；没有命令的是 role=status 的文字，名字带标题", async () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: [
            entry("a.unsaved", "未保存 2 个", {title: "未保存的文档", command: {id: "nbook.editor.save-all", args: {}}, tooltip: "第一章.md"}),
            entry("a.words", "1,200 字", {title: "字数"}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const button = wrapper.get('[data-workbench-item="a.unsaved"]');
        expect(button.element.tagName).toBe("BUTTON");
        expect(button.attributes("title")).toBe("第一章.md");
        expect(button.attributes("aria-label")).toBe("未保存的文档：未保存 2 个");
        await button.trigger("click");
        expect(wrapper.emitted("run")).toEqual([["a.unsaved"]]);
        const text = wrapper.get('[data-workbench-item="a.words"]');
        expect(text.attributes("role")).toBe("status");
        expect(text.attributes("aria-label")).toBe("字数：1,200 字");
        // 测量层不进读屏。
        expect(wrapper.get(".workbench-item-strip__measure").attributes("aria-hidden")).toBe("true");
    });

    it("命令不可用的条目禁用并以原因作提示，点了不发事件；出错的条目带错误样式", async () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: [
            entry("a.save", "全部保存", {command: {id: "nbook.editor.save-all", args: {}}, disabledReason: "没有需要保存的文档"}),
            entry("a.bad", "坏条目", {state: "error", tooltip: "这个条目出错了"}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const button = wrapper.get('[data-workbench-item="a.save"]');
        expect(button.attributes("disabled")).toBeDefined();
        expect(button.attributes("title")).toBe("没有需要保存的文档");
        await button.trigger("click");
        expect(wrapper.emitted("run")).toBeUndefined();
        expect(wrapper.get('[data-workbench-item="a.bad"]').classes()).toContain("workbench-item-strip__item--error");
    });

    it("名字里条目名与文字之间的标点随语言：英文用半角冒号；切换语言后原地换", async () => {
        const engine = createHostTextEngine({locale: "zh-CN", strict: true});
        engine.register("nbook.workbench", workbenchCatalogs.catalogs, workbenchCatalogs.source);
        const wrapper = mount(WorkbenchItemStrip, {props: {itemHeight: 20, align: "end", entries: [entry("a.words", "1,200 words", {title: "Words"})]}, global: {provide: provideText(engine.port)}});
        expect(wrapper.get('[data-workbench-item="a.words"]').attributes("aria-label")).toBe("Words：1,200 words");
        engine.setLocale("en-US");
        await nextTick();
        expect(wrapper.get('[data-workbench-item="a.words"]').attributes("aria-label")).toBe("Words: 1,200 words");
    });

    it("没有条目时什么都不画", () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: []}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        expect(wrapper.find("[data-workbench-item-strip]").exists()).toBe(false);
    });
});
