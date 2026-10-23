/**
 * `viewContribution`（docs/specs/runtime/plugin-api.md 的“SDK”）：一次给出视图的贡献声明与实现；包出的视图组件收到工作台给的
 * `context` 与入口补的属性，属性在渲染时求值。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, ref} from "vue";
import type {PropType} from "vue";

import {WORKBENCH_VIEWS_POINT} from "../shared/contracts";
import type {ViewContext} from "./contracts";
import {viewContribution} from "./view-contribution";

const View = defineComponent({
    name: "ProbeView",
    props: {
        context: {type: Object as PropType<ViewContext>, required: true},
        greeting: {type: String, required: true},
    },
    setup: (props) => () => h("p", {"data-view": props.context.id}, props.greeting),
});

const context: ViewContext = {id: "acme.hello.panel", generation: 1, visible: ref(true), location: ref("sidebar")};

describe("viewContribution", () => {
    it("贡献写在 workbench.views 下、id 只写一次；load 交模块（动态导入的写法），视图收到 context 与补的属性，属性读响应式的值时随之更新", async () => {
        const view = viewContribution({id: "acme.hello.panel", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, icon: "i-lucide-smile", location: "sidebar", layout: "scroll"}, load: async () => ({default: View})});
        expect(view.contribution).toMatchObject({capability: WORKBENCH_VIEWS_POINT, id: "acme.hello.panel"});
        const greeting = ref("你好");
        const component = await view.implementation(() => ({greeting: greeting.value})).load();
        const wrapper = mount(component, {props: {context}});
        expect(wrapper.get("[data-view]").attributes("data-view")).toBe("acme.hello.panel");
        expect(wrapper.text()).toBe("你好");
        greeting.value = "早上好";
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe("早上好");
        wrapper.unmount();
    });
});
