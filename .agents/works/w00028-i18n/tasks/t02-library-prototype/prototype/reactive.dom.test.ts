/**
 * w00028 t02 原型：渲染期调用 t()，切换语言与热装卸目录后不重新挂载也会更新。
 * 运行：`bun run test:vitest -- src/__i18n-spike__`（在 packages/neuro-book 下）。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {nextTick} from "vue";

import {createHostI18n, registerPlugin, unregisterPlugin} from "./host";
import Panel from "./Panel.vue";
import {createReactiveT} from "./reactive-t";
import aEn from "./locales/plugin-a.en-US.json";
import aZh from "./locales/plugin-a.zh-CN.json";
import bEn from "./locales/plugin-b.en-US.json";
import bZh from "./locales/plugin-b.zh-CN.json";

async function setup(language = "zh-CN") {
    const i18n = await createHostI18n({language});
    registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
    const {t} = createReactiveT(i18n);
    return {i18n, t};
}

function mountPanel(i18n: Awaited<ReturnType<typeof setup>>["i18n"], t: unknown, props: {ns: string; reactive: boolean; count?: number}) {
    let mounts = 0;
    const wrapper = mount(Panel, {
        props: {...props, onMounted: () => { mounts += 1; }},
        global: {provide: {t, plainT: (key: string, params?: Record<string, unknown>) => i18n.t(key, params as never)}},
    });
    return {wrapper, mounts: () => mounts};
}

describe("渲染期 t() 随语言切换", () => {
    it("shallowRef 版本号接法：切换语言后同一个组件实例更新文字，没有重新挂载", async () => {
        const {i18n, t} = await setup("zh-CN");
        const {wrapper, mounts} = mountPanel(i18n, t, {ns: "plugin-a", reactive: true, count: 1});
        const titleElement = wrapper.get("[data-title]").element;
        expect(wrapper.get("[data-title]").text()).toBe("插件甲");
        expect(wrapper.get("[data-files]").text()).toBe("1 个文件");

        await i18n.changeLanguage("en-US");
        await nextTick();
        expect(wrapper.get("[data-title]").text()).toBe("Plugin A");
        expect(wrapper.get("[data-files]").text()).toBe("1 file");
        // DOM 节点与挂载次数都没变
        expect(wrapper.get("[data-title]").element).toBe(titleElement);
        expect(mounts()).toBe(1);
    });

    it("对照：直接用 i18n.t 而不读响应式版本号，切换语言后文字不更新", async () => {
        const {i18n, t} = await setup("zh-CN");
        const {wrapper} = mountPanel(i18n, t, {ns: "plugin-a", reactive: false});
        await i18n.changeLanguage("en-US");
        await nextTick();
        expect(wrapper.get("[data-title]").text()).toBe("插件甲");
    });

    it("languageChanged 是在 changeLanguage 返回的 promise 结算之前同步触发的（资源已在内存时）", async () => {
        const {i18n} = await setup("zh-CN");
        const log: string[] = [];
        i18n.on("languageChanged", (lng) => log.push(`event ${lng}`));
        const pending = i18n.changeLanguage("en-US");
        log.push("after-call");
        await pending;
        log.push("settled");
        expect(log).toEqual(["event en-US", "after-call", "settled"]);
    });

    it("连续切换且不等待：最终语言是最后一次请求的，界面跟上", async () => {
        const {i18n, t} = await setup("zh-CN");
        const {wrapper} = mountPanel(i18n, t, {ns: "plugin-a", reactive: true});
        await Promise.all([i18n.changeLanguage("en-US"), i18n.changeLanguage("zh-CN"), i18n.changeLanguage("en-US")]);
        await nextTick();
        expect(i18n.language).toBe("en-US");
        expect(wrapper.get("[data-title]").text()).toBe("Plugin A");
    });

    it("目录热装卸：语言不变，插件 B 激活后文字出现，停用后退回键本身", async () => {
        const {i18n, t} = await setup("zh-CN");
        const {wrapper} = mountPanel(i18n, t, {ns: "plugin-b", reactive: true});
        expect(wrapper.get("[data-title]").text()).toBe("title");
        registerPlugin(i18n, "plugin-b", {"zh-CN": bZh, "en-US": bEn});
        await nextTick();
        expect(wrapper.get("[data-title]").text()).toBe("插件乙");
        unregisterPlugin(i18n, "plugin-b", ["zh-CN", "en-US"]);
        await nextTick();
        expect(wrapper.get("[data-title]").text()).toBe("title");
    });

    it("卸载组件后监听器不残留：dispose 之后切换语言不再触发版本号变化", async () => {
        const i18n = await createHostI18n({language: "zh-CN"});
        const before = (i18n as unknown as {observers: Record<string, unknown>}).observers?.languageChanged;
        const {dispose} = createReactiveT(i18n);
        const during = (i18n as unknown as {observers: Record<string, Map<unknown, number>>}).observers.languageChanged.size;
        dispose();
        const after = (i18n as unknown as {observers: Record<string, Map<unknown, number>>}).observers.languageChanged.size;
        expect([before, during, after]).toEqual([undefined, 1, 0]);
    });
});
