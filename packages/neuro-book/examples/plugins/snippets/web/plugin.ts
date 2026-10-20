/**
 * `example.snippets` 的浏览器入口：向设置窗口贡献一个 page 分区，自己画片段列表的编辑页。读这个文件学三件事：
 *
 * 1. **什么时候用 page 分区，而不是 list 分区**：list 分区由设置窗口按配置项的 schema 画控件，插件只写声明、不写界面；
 *    但通用控件只有开关、选项、数字与单行文字，别的类型只读显示（docs/specs/settings/settings-window.md 输出第 9 条）。
 *    片段是对象的数组，要增删改、排顺序，只能由插件自己画，所以向 `settings.pages` 贡献 page 分区。值是普通开关、选项时，
 *    写 `section` 指向一个 list 分区（或干脆不写，落到“其它”）就够了，不要为它写页面。list 分区是向 `settings.sections`
 *    的顶层声明，写在插件描述里，没有实现，也就不需要入口。
 * 2. **页面怎样拿到配置服务**：页面组件里不能解析服务。入口激活时拿到**本插件自己的**配置服务（`settingsKey`），在
 *    `load()` 交出的组件里把它传给页面。页面只能用它写本插件声明的项（configuration.md 输出第 11 条）。
 * 3. **交付与撤回**：分区的声明在入口激活前就在设置窗口的左栏里（显示“正在等待……启动”）；入口激活后实现交给设置窗口，
 *    第一次显示这个分区时才调用 `load()`；入口停止时内核撤回实现，窗口原位显示停止原因
 *    （settings-window.md 输出第 1、4、5 条）。
 *
 * 对应的场景：`scenarios/06-settings-page.test.ts`。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {SETTINGS_PAGES_POINT, settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageContext, SettingsPageImplementation} from "nbook/plugins/settings/web/contracts";
import type {SettingsService} from "nbook/shared/settings";

import {descriptor} from "../plugin";
import {SNIPPETS_SECTION} from "../shared/contracts";

/**
 * 分区声明：纯数据，激活前内核就校验它（settings-window.md“分区声明”的规则表）。
 *
 * - `category: "plugins"`：第三方插件的分区放在左栏的“插件”一组。
 * - `layout: "column"`：页面放进窗口的内容列，与通用列表同样的内边距与封顶宽度，内容列负责滚动；只有要自己分左右两栏
 *   的页面（例如服务商列表加详情）才用 `fill`。
 * - `layers` 不写，缺省“用户”“本作品”两个标签下都可用：要与页面里配置项允许的层一致，片段两层都允许。只允许用户层的
 *   页面写 `layers: ["user"]`，“本作品”标签下它在左栏停用（settings-window.md 输出第 8 条）。
 */
const SECTION: SettingsPageDeclaration = {
    title: {"zh-CN": "常用片段", "en-US": "Snippets"},
    description: {"zh-CN": "写作时常用的固定文字", "en-US": "Fixed text you insert often"},
    icon: "i-lucide-text-quote",
    category: "plugins",
    layout: "column",
};

export const snippetsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 还没有“打开设置窗口时才激活”的激活事件，只能启动即激活；不激活，实现就不会交给设置窗口，分区一直是“正在等待”。
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}],
        contributions: [{capability: SETTINGS_PAGES_POINT, id: SNIPPETS_SECTION, declaration: SECTION}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const page: SettingsPageImplementation = {
                // 页面组件按需加载：设置窗口第一次显示这个分区时才调用，没打开过设置的窗口不下载它。
                load: async () => withSettings((await import("./SnippetsPage.vue")).default, settings),
            };
            return {contributions: {[SETTINGS_PAGES_POINT]: {[SNIPPETS_SECTION]: page}}};
        },
    })],
};

/**
 * 设置窗口只给页面一个属性 `context`；配置服务由这里包一层补上。用渲染函数写：场景测试在 Bun 里导入本文件，Bun 不能
 * 加载 `.vue`，`.vue` 只在 `load()` 里动态导入。
 */
function withSettings(page: Component, settings: SettingsService): Component {
    return defineComponent({
        name: "SnippetsSettingsPage",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => () => h(page, {context: props.context, settings}),
    });
}
