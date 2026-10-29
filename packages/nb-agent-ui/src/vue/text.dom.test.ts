/**
 * 组件从哪个端口取文字（`text.ts`，docs/specs/ui/agent-conversation-view.md“边界与兼容”）：宿主注入的端口优先；没有注入时
 * 根组件按 `locale` 建缺省端口给子树（嵌套的 nb-ui 控件也拿得到）；零件单独挂载时是中文。
 */
import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref} from "vue";
import type {PropType, Ref} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "../locales";
import type {AgentLocale} from "../types";
import {provideAgentText, useAgentText} from "./text";

/** 子树里的零件：本包的一条文字、当前语言，以及嵌套的 nb-ui 控件经 `useText()` 看到的语言。 */
const Part = defineComponent({
    setup() {
        const {t, locale} = useAgentText();
        const nested = useText();
        return () => h("span", {"data-part": ""}, `${t("composer.send")}|${locale.value}|${nested.locale.value}`);
    },
});

/** 根组件的写法：没有注入时按 `locale` 建端口给子树。 */
const Root = defineComponent({
    props: {locale: {type: String as PropType<AgentLocale>, default: undefined}},
    setup(props) {
        const {t} = provideAgentText(() => props.locale);
        return () => h("div", [h("b", t("composer.stop")), h(Part)]);
    },
});

function hostPort(initial: string): {port: TextPort; locale: Ref<string>} {
    const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS}, strict: true});
    const locale = ref(initial);
    return {locale, port: {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)}};
}

describe("组件取文字的端口", () => {
    it("零件单独挂载、上面没有注入：缺省端口，中文", () => {
        expect(mount(Part).text()).toBe("发送|zh-CN|zh-CN");
    });

    it("没有注入时根组件按 locale 建端口，子组件与嵌套的 nb-ui 控件拿到同一个；locale 变了跟着变", async () => {
        const root = mount(Root, {props: {locale: "en-US"}});
        expect(root.get("b").text()).toBe("Stop");
        expect(root.get("[data-part]").text()).toBe("Send|en-US|en-US");
        await root.setProps({locale: "zh-CN"});
        expect(root.get("[data-part]").text()).toBe("发送|zh-CN|zh-CN");
        expect(mount(Root).get("[data-part]").text()).toBe("发送|zh-CN|zh-CN");
    });

    it("宿主注入了端口时以它为准，根组件的 locale 不起作用；端口换语言，文字跟着换", async () => {
        const host = hostPort("en-US");
        const root = mount(Root, {props: {locale: "zh-CN"}, global: {provide: {[TEXT_PORT_KEY as symbol]: host.port}}});
        expect(root.get("b").text()).toBe("Stop");
        expect(root.get("[data-part]").text()).toBe("Send|en-US|en-US");
        host.locale.value = "zh-CN";
        await nextTick();
        expect(root.get("b").text()).toBe("停止");
        expect(root.get("[data-part]").text()).toBe("发送|zh-CN|zh-CN");
    });
});
