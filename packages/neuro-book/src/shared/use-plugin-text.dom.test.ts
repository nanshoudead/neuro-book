/** `usePluginText` 绑定命名空间并读注入的端口：切换语言后同一个函数给出新语言的文字。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";

import {createTextEngine} from "nbook/web/host/text-engine";

import {boundText, usePluginText} from "./use-plugin-text";
import {provideText} from "./testing/text-port";

const zhCN = {greeting: "你好，{{name}}", files: {count_other: "{{count}} 个文件"}} as const;
const enUS = {greeting: "Hello, {{name}}", files: {count_one: "{{count}} file", count_other: "{{count}} files"}};

describe("usePluginText", () => {
    it("组件里一步取文字，语言切换后不重新挂载就换文字", async () => {
        const engine = createTextEngine({locale: "zh-CN", strict: true});
        engine.register("x.demo", {"zh-CN": zhCN, "en-US": enUS}, "zh-CN");
        const Demo = defineComponent({
            setup() {
                const text = usePluginText<typeof zhCN>("x.demo");
                return () => h("p", `${text("greeting", {name: "A"})}|${text("files.count", {count: 2})}`);
            },
        });
        const wrapper = mount(Demo, {global: {provide: provideText(engine.port)}});
        expect(wrapper.text()).toBe("你好，A|2 个文件");
        engine.setLocale("en-US");
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe("Hello, A|2 files");
    });

    it("boundText 给不在组件里的函数用", () => {
        const engine = createTextEngine({locale: "en-US", strict: true});
        engine.register("x.demo", {"zh-CN": zhCN, "en-US": enUS}, "zh-CN");
        expect(boundText<typeof zhCN>(engine.port, "x.demo")("greeting", {name: "B"})).toBe("Hello, B");
    });
});
