/** docs/specs/ui/i18n.md 输出 8 与验收 1：缺省端口、注入的端口、切换语言不重新挂载。 */

import {mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, onMounted, ref} from "vue";
import {describe, expect, it} from "vitest";

import {textRef} from "../text";
import {createMinimalTranslator} from "../text/minimal";
import {provideDefaultText, registerDefaultCatalog, TEXT_PORT_KEY, useText} from "./index";
import type {TextPort} from "./index";

let mounts = 0;
const Probe = defineComponent({
    setup() {
        const port = useText();
        onMounted(() => {
            mounts += 1;
        });
        return () => h("span", [port.t(textRef("greeting", undefined, "demo")), " ", port.locale.value]);
    },
});

describe("翻译端口", () => {
    it("输出 8：没有宿主注入时用 nb-ui 的缺省端口，语言是 zh-CN", () => {
        const wrapper = mount(Probe);
        expect(wrapper.text()).toBe("greeting zh-CN");
    });

    it("输出 8：缺省端口含所有已登记的目录，先画过、后登记的命名空间也翻得出", () => {
        // 命名空间只给这一例用：登记表在进程里共用，不会被别的用例看到。
        const Late = defineComponent({setup: () => {
            const port = useText();
            return () => h("span", port.t(textRef("hello", undefined, "text-port-test.late")));
        }});
        expect(mount(Late).text()).toBe("hello");
        registerDefaultCatalog("text-port-test.late", {"zh-CN": {hello: "你好"}, "en-US": {hello: "Hello"}});
        expect(mount(Late).text()).toBe("你好");
    });

    it("输出 8：根组件没有注入时按 locale 建缺省端口给子树；标签取规范写法，不合法的按 zh-CN", async () => {
        registerDefaultCatalog("text-port-test.root", {"zh-CN": {n_other: "{{count}} 条"}, "en-US": {n_one: "{{count}} item", n_other: "{{count}} items"}});
        const Child = defineComponent({setup: () => {
            const port = useText();
            return () => h("i", `${port.t(textRef("n", {count: 1}, "text-port-test.root"))}|${port.locale.value}`);
        }});
        const Root = defineComponent({
            props: {locale: {type: String, default: undefined}},
            setup(props) {
                provideDefaultText(() => props.locale);
                return () => h(Child);
            },
        });
        const root = mount(Root, {props: {locale: "en-us"}});
        expect(root.text()).toBe("1 item|en-US");
        await root.setProps({locale: "zh_CN"});
        expect(root.text()).toBe("1 条|zh-CN");
        await root.setProps({locale: ""});
        expect(root.text()).toBe("1 条|zh-CN");
    });

    it("验收 1：宿主注入的端口切换语言后，组件不重新挂载就换文字", async () => {
        const translator = createMinimalTranslator({catalogs: {demo: {"zh-CN": {greeting: "你好"}, "en-US": {greeting: "Hello"}}}});
        const locale = ref("zh-CN");
        const port: TextPort = {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
        mounts = 0;
        const wrapper = mount(Probe, {global: {provide: {[TEXT_PORT_KEY as symbol]: port}}});
        expect(wrapper.text()).toBe("你好 zh-CN");
        locale.value = "en-US";
        await nextTick();
        expect(wrapper.text()).toBe("Hello en-US");
        expect(mounts).toBe(1);
    });
});
