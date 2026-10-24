/**
 * 浏览器入口：一个侧栏视图、一条命令。入口激活时拿到设置服务，经视图的 `props` 交给视图组件（组件里不能解析服务）。
 */

import {ref} from "vue";

import {COMMANDS_POINT, defineEntry, settingsKey, WORKBENCH_VIEWS_POINT} from "@notnotype/nb-plugin-sdk";
import type {CommandDeclaration, CommandImplementation, PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {viewContribution} from "@notnotype/nb-plugin-sdk/browser";
import {Type} from "typebox";

import {descriptor} from "../plugin";
import {greeting} from "../shared/contracts";

const view = viewContribution({
    id: `${descriptor.id}.hello`,
    declaration: {title: {"zh-CN": "__DISPLAY_NAME__", "en-US": "__DISPLAY_NAME__"}, icon: "i-lucide-hand", location: "sidebar", layout: "scroll"},
    // 第一次显示视图时才加载组件。
    load: () => import("./HelloView.vue"),
});

const SAY_HELLO = `${descriptor.id}.say-hello`;
const sayHello: CommandDeclaration = {
    title: {"zh-CN": "__DISPLAY_NAME__：打个招呼", "en-US": "__DISPLAY_NAME__: Say hello"},
    // 给 Agent 看的说明，用英文写。
    description: "Count one more greeting in the __DISPLAY_NAME__ view",
    args: Type.Object({}, {additionalProperties: false}),
    // 会改状态（这里是计数）就是 `write`：只读模式下 Agent 不能执行它。
    effect: "write",
};

export const browserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 窗口启动就激活：视图的实现要等入口激活才交出，不激活视图就只有标题、没有内容。代价是每个窗口启动时都下载并
        // 执行这个入口；只在某处用到的功能，换成那里的激活事件（例如设置分区的 `settingsPageContribution`）。
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}],
        contributions: [view.contribution, {capability: COMMANDS_POINT, id: SAY_HELLO, declaration: sayHello}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const count = ref(0);
            const run: CommandImplementation = {run: () => {
                count.value += 1;
                return {ok: true, value: count.value};
            }};
            return {contributions: {
                // `props` 在渲染时求值：读到的设置与计数变化时，视图跟着更新。
                [WORKBENCH_VIEWS_POINT]: {[view.id]: view.implementation(() => ({greeting: settings.get(greeting), count: count.value, sayHello: () => void run.run({})}))},
                [COMMANDS_POINT]: {[SAY_HELLO]: run},
            }};
        },
    })],
};
