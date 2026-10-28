/**
 * 表单从哪个端口取文字（`text.ts`，docs/specs/ui/forms.md 输出 24）：宿主注入的端口优先，根的 `locale` 不起作用；没有注入时
 * 根按 `locale` 建包内的缺省端口给子树（嵌套的 nb-ui 控件也拿得到）；描述里写目录里的键时经端口翻译。
 */
import {mount} from "@vue/test-utils";
import {Type} from "typebox";
import {defineComponent, h, nextTick, ref} from "vue";
import type {Ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE} from "../locales";
import SchemaField from "./SchemaField.vue";
import SchemaForm from "./SchemaForm.vue";
import {provideFormText, useFormText} from "./text";

afterEach(() => {
    document.body.innerHTML = "";
});

/** 插件目录里的一条：描述里的文字可以引用它。 */
const PLUGIN = {"zh-CN": {unit: "像素", name: "字号"}, "en-US": {unit: "px", name: "Font size"}};

function hostPort(initial: string): {port: TextPort; locale: Ref<string>} {
    const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_FORM_NAMESPACE]: NB_FORM_CATALOGS, demo: PLUGIN}, strict: true});
    const locale = ref(initial);
    return {locale, port: {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)}};
}

/** 子树里的零件：本包的一条文字、当前语言，以及嵌套的 nb-ui 控件经 `useText()` 看到的语言。 */
const Part = defineComponent({
    setup() {
        const text = useFormText();
        const nested = useText();
        return () => h("span", {"data-part": ""}, `${text.t("add")}|${text.locale.value}|${nested.locale.value}`);
    },
});

const Root = defineComponent({
    props: {locale: {type: String, default: undefined}},
    setup(props) {
        const text = provideFormText(() => props.locale);
        return () => h("div", [h("b", text.t("remove")), h(Part)]);
    },
});

describe("表单取文字的端口", () => {
    it("在表单的根之外、上面没有注入：包内的缺省端口，中文", () => {
        expect(mount(Part).text()).toBe("添加|zh-CN|zh-CN");
    });

    it("没有注入时根按 locale 建端口，子组件与嵌套的 nb-ui 控件拿到同一个；locale 变了跟着变", async () => {
        const root = mount(Root, {props: {locale: "en-US"}});
        expect(root.get("b").text()).toBe("Remove");
        expect(root.get("[data-part]").text()).toBe("Add|en-US|en-US");
        await root.setProps({locale: "zh-CN"});
        expect(root.get("[data-part]").text()).toBe("添加|zh-CN|zh-CN");
        expect(mount(Root).get("[data-part]").text()).toBe("添加|zh-CN|zh-CN");
    });

    it("宿主注入了端口时以它为准，表单的 locale 不起作用；端口换语言不重挂就换", async () => {
        const host = hostPort("en-US");
        const schema = Type.Object({name: Type.String({minLength: 3, title: "名称"})});
        const wrapper = mount(SchemaForm, {attachTo: document.body, props: {schema, modelValue: {name: "a"}, locale: "zh-CN"}, global: {provide: {[TEXT_PORT_KEY as symbol]: host.port}}});
        await wrapper.get("[data-nb-form-summary] button").trigger("click");
        expect(wrapper.get("[data-nb-form-summary]").text()).toContain("1 issue");
        expect(wrapper.get("[data-nb-form-summary] li").text()).toContain("At least 3 characters");
        host.locale.value = "zh-CN";
        await nextTick();
        expect(wrapper.get("[data-nb-form-summary]").text()).toContain("1 个问题");
        expect(wrapper.get("[data-nb-form-summary] li").text()).toContain("至少 3 个字符");
        wrapper.unmount();
    });

    it("描述里的标题与单位写目录里的键时经端口翻译", async () => {
        const host = hostPort("en-US");
        const schema = Type.Integer({"x-form": {label: {kind: "text", ns: "demo", key: "name"}, unit: {kind: "text", ns: "demo", key: "unit"}}});
        const wrapper = mount(SchemaField, {attachTo: document.body, props: {schema, modelValue: 14, id: "size"}, global: {provide: {[TEXT_PORT_KEY as symbol]: host.port}}});
        expect(wrapper.get("label").text()).toBe("Font size");
        expect(wrapper.text()).toContain("px");
        host.locale.value = "zh-CN";
        await nextTick();
        expect(wrapper.get("label").text()).toBe("字号");
        expect(wrapper.text()).toContain("像素");
        wrapper.unmount();
    });
});
