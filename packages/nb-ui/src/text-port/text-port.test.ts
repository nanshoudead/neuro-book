/** docs/specs/ui/i18n.md 输出 8 与验收 1：缺省端口、注入的端口、切换语言不重新挂载。 */

import {mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, onMounted, ref} from "vue";
import {describe, expect, it} from "vitest";

import {textRef} from "../text";
import {createMinimalTranslator} from "../text/minimal";
import {TEXT_PORT_KEY, useText} from "./index";
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
