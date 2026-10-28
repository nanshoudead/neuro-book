/**
 * MarkdownImage（同名 .md）：读取中、显示、不显示、读不出四种状态；地址给出的资源在换地址、刷新与卸载时释放，迟到的结果释放后丢掉。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {h, render} from "vue";
import {describe, expect, it} from "vitest";

import MarkdownImage from "./MarkdownImage.vue";

/** 由测试决定何时、给什么结果的解析：记下每次调用与释放。 */
function deferredResolver() {
    const calls: Array<{readonly src: string; readonly signal: AbortSignal; resolve(value: {url: string} | null): void}> = [];
    const released: string[] = [];
    const resolveAsset = (src: string, signal: AbortSignal) => new Promise<{url: string; release(): void} | null>((resolve) => {
        calls.push({src, signal, resolve: (value) => resolve(value === null ? null : {url: value.url, release: () => released.push(value.url)})});
    });
    return {calls, released, resolveAsset};
}

describe("MarkdownImage", () => {
    it("没有解析或解析给不出时不显示，写明原因；读取中是占位；给出 URL 后显示，加载失败为读不出", async () => {
        const none = mount(MarkdownImage, {props: {src: "../外面.png", alt: "外面"}});
        expect(none.attributes("data-state")).toBe("none");
        expect(none.text()).toBe("外面（不显示）");
        // 宿主给的说明（neuro-book 写明是不在作品里）。
        const own = mount(MarkdownImage, {props: {src: "../外面.png", alt: "外面", missing: {"zh-CN": "{name}（不在作品里，不显示）", "en-US": "{name} (not in the work, not shown)"}}});
        expect(own.text()).toBe("外面（不在作品里，不显示）");

        const resolver = deferredResolver();
        const wrapper = mount(MarkdownImage, {props: {src: "a.png", alt: "封面", title: "第一卷", resolveAsset: resolver.resolveAsset}});
        expect([wrapper.attributes("data-state"), wrapper.text()]).toEqual(["loading", "封面"]);
        resolver.calls[0]?.resolve({url: "/raw/a.png"});
        await flushPromises();
        const img = wrapper.find("img");
        expect([img.attributes("src"), img.attributes("alt"), img.attributes("title")]).toEqual(["/raw/a.png", "封面", "第一卷"]);
        await img.trigger("error");
        expect([wrapper.attributes("data-state"), wrapper.text()]).toEqual(["failed", "封面 读不出"]);
    });

    it("没有应用上下文时照常显示（包内的缺省端口，中文）：展示器的静态视图与编辑器的节点视图用 render() 把它挂到普通 DOM 上", () => {
        const element = document.createElement("div");
        render(h(MarkdownImage, {src: "x.png", alt: "甲"}), element);
        expect(element.textContent?.trim()).toBe("甲（不显示）");
        render(null, element);
    });

    it("换地址、刷新与卸载各释放一次上一份；卸载之后才到的结果立即释放", async () => {
        const resolver = deferredResolver();
        const wrapper = mount(MarkdownImage, {props: {src: "a.png", resolveAsset: resolver.resolveAsset}});
        resolver.calls[0]?.resolve({url: "u1"});
        await flushPromises();
        await wrapper.setProps({refresh: 1});
        expect(resolver.released).toEqual(["u1"]);
        resolver.calls[1]?.resolve({url: "u2"});
        await flushPromises();
        await wrapper.setProps({src: "b.png"});
        expect(resolver.released).toEqual(["u1", "u2"]);
        expect(resolver.calls.map((call) => call.src)).toEqual(["a.png", "a.png", "b.png"]);
        wrapper.unmount();
        expect(resolver.calls[2]?.signal.aborted).toBe(true);
        resolver.calls[2]?.resolve({url: "u3"});
        await flushPromises();
        expect(resolver.released).toEqual(["u1", "u2", "u3"]);
    });
});
