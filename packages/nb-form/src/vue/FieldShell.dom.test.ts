/**
 * 字段外壳的状态图标与提示（docs/specs/ui/forms.md 输出 14）：标题后面只有一个图标，色调取最重的，提示逐行列出全部
 * 原因；焦点在控件上时提示也显示。图标不改变字段高度靠样式，真实布局由应用 Component Lab 的 Playwright 看。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h} from "vue";
import {afterEach, describe, expect, it, vi} from "vitest";

import FieldShell from "./FieldShell.vue";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Props = Record<string, unknown>;

function mountShell(props: Props) {
    const wrapper = mount(FieldShell, {
        attachTo: document.body,
        props: {id: "f", locale: "zh-CN", label: "并发数", ...props},
        slots: {default: '<input id="f">'},
    });
    mounted.push(wrapper);
    return wrapper;
}

/** 提示浮层里看得见的各行（浮层在 body 下，不在组件里；读屏用的隐藏副本不算）。 */
const tooltipLines = () => [...document.body.querySelectorAll(".nb-ui-tooltip-surface .nb-form-field__reason-line")].map((line) => line.textContent);
const icons = (wrapper: VueWrapper) => wrapper.findAll(".nb-form-field__reason");

describe("FieldShell 的状态图标", () => {
    it("没有原因时没有图标；只有一类原因时按它定色调：出错、警告、状态", () => {
        expect(icons(mountShell({}))).toHaveLength(0);
        const tones = [{errorText: "不对"}, {warnings: ["偏小"]}, {status: "没有网络"}].map((props) => icons(mountShell(props)).map((icon) => icon.attributes("data-tone")));
        expect(tones).toEqual([["error"], ["warning"], ["muted"]]);
    });

    it("图标紧跟在标题后面，不是浏览器原生的 title", () => {
        const wrapper = mountShell({errorText: "不对", warnings: ["偏小"]});
        const label = wrapper.get("label");
        expect(label.element.nextElementSibling).toBe(icons(wrapper)[0]!.element);
        expect(wrapper.find("[title]").exists()).toBe(false);
    });

    it("出错、警告、状态同时有：只画一个图标，色调是出错，聚焦控件后提示按这个顺序列出全部原因", async () => {
        const wrapper = mountShell({errorText: "不能小于 1", warnings: ["偏大"], status: "没有网络"});
        expect(icons(wrapper)).toHaveLength(1);
        expect(icons(wrapper)[0]!.attributes("data-tone")).toBe("error");
        wrapper.get("input").element.focus();
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual(["不能小于 1", "偏大", "没有网络"]);
        });
    });

    it("焦点在控件上时提示可见，失焦后隐藏", async () => {
        const wrapper = mountShell({errorText: "不对"});
        expect(tooltipLines()).toEqual([]);
        const input = wrapper.get("input").element;
        input.focus();
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual(["不对"]);
        });
        input.blur();
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual([]);
        });
    });

    it("焦点在字段内部的“清除”上移动不收起提示；对象里成员的焦点属于成员自己的图标", async () => {
        // 浏览器里 focusout 先到、focusin 在后，中间会清一次微任务队列：只发 focusout（带上新焦点所在的“清除”），
        // 提示不能在这一间隙里收起。关得慢也算在内，所以并排放一个照常失焦的字段当对照：它的提示关了，这一个还开着。
        const moving = mountShell({id: "a", errorText: "甲", clearLabel: "清除"});
        const leaving = mountShell({id: "b", errorText: "乙"});
        const focusEvent = (type: string, relatedTarget: EventTarget | null = null) => new FocusEvent(type, {bubbles: true, relatedTarget});
        moving.get("input").element.dispatchEvent(focusEvent("focusin"));
        leaving.get("input").element.dispatchEvent(focusEvent("focusin"));
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual(["甲", "乙"]);
        });
        moving.get("input").element.dispatchEvent(focusEvent("focusout", moving.get("button").element));
        leaving.get("input").element.dispatchEvent(focusEvent("focusout"));
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual(["甲"]);
        });

        const Nested = defineComponent({
            setup: () => () => h(FieldShell, {id: "outer", locale: "zh-CN", label: "对象", group: true, errorText: "外层出错"}, {
                default: () => h(FieldShell, {id: "inner", locale: "zh-CN", label: "成员", errorText: "成员出错"}, {default: () => h("input", {id: "inner"})}),
            }),
        });
        const nested = mount(Nested, {attachTo: document.body});
        mounted.push(nested);
        nested.get<HTMLInputElement>("#inner").element.focus();
        await vi.waitFor(() => {
            expect(tooltipLines()).toContain("成员出错");
        });
        expect(tooltipLines()).not.toContain("外层出错");
    });
});
