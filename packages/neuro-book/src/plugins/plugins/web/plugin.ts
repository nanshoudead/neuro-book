/**
 * `nbook.plugins` 的浏览器入口：向设置窗口贡献“插件”分区的页面（docs/specs/runtime/plugin-install.md 输出 1–4、7–9）。
 *
 * page 分区要有实现，所以写在入口下而不是插件描述的顶层（docs/specs/settings/settings-window.md）。设置窗口只给页面
 * `context`；远程合同的客户端、显示语言与本窗口的插件状态由这里经闭包交给页面，不扩张设置窗口给页面的上下文。
 */

import {computed, defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {displayLocale, SETTINGS_PAGES_POINT, settingsKey, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageContext, SettingsPageImplementation} from "nbook/plugins/settings/web/contracts";
import {windowPluginsKey} from "nbook/shared/host";
import type {WindowPlugins} from "nbook/shared/host";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {descriptor} from "../plugin";
import {pluginsRegistryContract} from "../shared/contracts";
import type {PluginsRegistry} from "../shared/contracts";

/** 设置分区 id：内置插件以 `nbook.` 开头，点分小写段。 */
export const PLUGINS_SECTION = "nbook.plugins.installed";

const SECTION: SettingsPageDeclaration = {
    title: {"zh-CN": "插件", "en-US": "Plugins"},
    description: {"zh-CN": "安装与管理第三方插件", "en-US": "Install and manage third-party plugins"},
    icon: "i-lucide-puzzle",
    category: "plugins",
    layout: "column",
    layers: ["user"],
};

export const pluginsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 打开设置窗口的“插件”分区时才激活（settings-window.md 输出 4）。
        activationEvents: [settingsPageEvent(PLUGINS_SECTION)],
        // 本窗口的插件问题（入口失败、受阻、被拒的贡献）经宿主能力 `window.plugins` 查；拿不到时插件页只显示服务端的。
        dependencies: [{key: settingsKey}, {key: windowPluginsKey, required: false}],
        contributions: [{capability: SETTINGS_PAGES_POINT, id: PLUGINS_SECTION, declaration: SECTION}],
        activate: async (context) => {
            const settings = context.services.require(settingsKey);
            const windowPlugins = await context.services.resolve(windowPluginsKey);
            const registry = context.remote.use(pluginsRegistryContract);
            const locale = computed(() => displayLocale(settings));
            const page: SettingsPageImplementation = {
                load: async () => withRegistry((await import("./components/PluginsPage.vue")).default, registry, locale, windowPlugins.status === "resolved" ? windowPlugins.instance : null),
            };
            return {contributions: {[SETTINGS_PAGES_POINT]: {[PLUGINS_SECTION]: page}}};
        },
    })],
};

/**
 * 设置窗口只给页面一个 `context` 属性；合同客户端与当前显示语言由这里补上。用渲染函数写：插件的合同测试在 bun test
 * 里导入本文件，Bun 不能加载 `.vue`，`.vue` 只在 `load()` 里动态导入。
 */
function withRegistry(page: Component, registry: PluginsRegistry, locale: Readonly<{value: DisplayLocale}>, windowPlugins: WindowPlugins | null): Component {
    return defineComponent({
        name: "PluginsSettingsSection",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: () => () => h(page, {registry, locale: locale.value, windowPlugins}),
    });
}
