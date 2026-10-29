/**
 * 宿主模块表（docs/specs/runtime/plugin-code-loading.md 输出 3）：插件 `require` 到的就是宿主自己用的那一份，不是另一份同名
 * 的模块。按身份核对，不按行为：第二份 Vue 有时行为上也能碰巧通过。
 */

import {Button} from "@notnotype/nb-ui/components";
import {TEXT_PORT_KEY, useText} from "@notnotype/nb-ui/text-port";
import {mount} from "@vue/test-utils";
import {computed} from "@vue/reactivity";
import {Type} from "typebox";
import {Compile} from "typebox/compile";
import {Value} from "typebox/value";
import {describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import {command} from "nbook/sdk/commands";
import {defineEntry} from "nbook/sdk/index";
import {setting} from "nbook/sdk/settings";
import {settingsPage} from "nbook/sdk/settings-browser";
import {definePublicState} from "nbook/sdk/state";
import {defineRecord} from "nbook/sdk/storage";
import {view} from "nbook/sdk/workbench";
import {pluginText} from "nbook/sdk/text";
import {BROWSER_SHARED_MODULES} from "nbook/plugin-platform-profile";

import {createHostTextEngine} from "./text-engine";

import {hostModules} from "./plugin-modules";

describe("浏览器的宿主模块表", () => {
    it("键与构建预设的共享模块表一致；每一项都是宿主那一份，冻结", () => {
        const table = hostModules() as Record<string, Record<string, unknown>>;
        expect(Object.keys(table).sort()).toEqual([...BROWSER_SHARED_MODULES].sort());
        expect(table["vue"]!.ref).toBe(ref);
        expect(table["vue"]!.defineComponent).toBe(defineComponent);
        expect(table["@vue/reactivity"]!.computed).toBe(computed);
        expect(table["typebox"]!.Type).toBe(Type);
        expect(table["typebox/value"]!.Value).toBe(Value);
        expect(table["typebox/compile"]!.Compile).toBe(Compile);
        // 组件经 SDK 的子路径给出，仍是宿主用的那一份 nb-ui。
        expect(table["@notnotype/nb-plugin-sdk/components"]!.Button).toBe(Button);
        expect(table["@notnotype/nb-plugin-sdk"]!.defineEntry).toBe(defineEntry);
        // 每个内置插件的子路径都是宿主那一份。
        expect(table["@notnotype/nb-plugin-sdk/state"]!.definePublicState).toBe(definePublicState);
        expect(table["@notnotype/nb-plugin-sdk/storage"]!.defineRecord).toBe(defineRecord);
        expect(table["@notnotype/nb-plugin-sdk/settings"]!.setting).toBe(setting);
        expect(table["@notnotype/nb-plugin-sdk/settings/browser"]!.settingsPage).toBe(settingsPage);
        expect(table["@notnotype/nb-plugin-sdk/commands"]!.command).toBe(command);
        expect(table["@notnotype/nb-plugin-sdk/workbench"]!.view).toBe(view);
        expect(table["@notnotype/nb-plugin-sdk/text"]!.pluginText).toBe(pluginText);
        // 取文字的组合函数就是宿主 nb-ui 的那一份：它注入的键与窗口根上提供端口的键是同一个模块里的同一个值。
        expect(table["@notnotype/nb-plugin-sdk/text/browser"]!.useText).toBe(useText);
        expect(Object.isFrozen(table)).toBe(true);
        expect(Object.isFrozen(table["vue"])).toBe(true);
    });

    it("插件组件经 SDK 的 `/text/browser` 取到窗口根上注入的翻译端口：翻的是插件自己的目录，切换界面语言后跟着换（docs/specs/ui/i18n.md 输出 4）", async () => {
        const table = hostModules() as Record<string, Record<string, unknown>>;
        const sdkText = table["@notnotype/nb-plugin-sdk/text/browser"] as {usePluginText: (ns: string) => (key: string) => string};
        const engine = createHostTextEngine({locale: "zh-CN", strict: true});
        engine.register("acme.hello", {"zh-CN": {greeting: "你好"}, "en-US": {greeting: "Hello"}}, "zh-CN");
        const PluginView = defineComponent({setup: () => {
            const text = sdkText.usePluginText("acme.hello");
            return () => h("p", text("greeting"));
        }});
        // 窗口根注入端口的写法（`TEXT_PORT_KEY` 取自宿主的 nb-ui）。
        const wrapper = mount(PluginView, {global: {provide: {[TEXT_PORT_KEY as symbol]: engine.port}}});
        expect(wrapper.text()).toBe("你好");
        engine.setLocale("en-US");
        await nextTick();
        expect(wrapper.text()).toBe("Hello");
        wrapper.unmount();
    });
});
