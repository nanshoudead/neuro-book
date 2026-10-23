/**
 * `example.focus` 的浏览器入口：侧栏视图、状态栏条目与三条命令。读这个文件学三件事：
 *
 * 1. **启动即激活**：视图与状态栏条目的实现都在入口激活时交出，不激活，状态栏就没有这一项、视图只有标题（docs/specs/ui/
 *    workbench-shell.md 的状态栏条目、docs/specs/workbench/views.md）。代价是每个窗口启动时都下载、执行这个入口；只在某处才用
 *    到的功能，换成那里的激活事件。
 * 2. **以自己的身份调用自己的服务端**：`context.remote.use(合同)`，合同写在服务端入口的 `remoteProvides` 里、`callers` 含
 *    browser。状态放在 `focus-store.ts`，视图、条目、命令都读它。
 * 3. **把服务交给视图组件**：组件里不能解析服务，`viewContribution` 的 `implementation(props)` 在渲染时求值，把 store 交过去。
 *
 * 对应的场景：`scenarios/07-focus.test.ts`；组件测试：`FocusPanel.dom.test.ts`。
 */

import {COMMANDS_POINT, defineEntry, hostClockKey, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "@notnotype/nb-plugin-sdk";
import type {CommandDeclaration, CommandImplementation, ContributionDeclaration, ItemDeclaration, PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {viewContribution} from "@notnotype/nb-plugin-sdk/browser";
import type {ItemImplementation} from "@notnotype/nb-plugin-sdk/browser";
import {Type} from "typebox";

import {descriptor} from "../plugin";
import {CANCEL_COMMAND, sessionsContract, START_COMMAND, TOGGLE_COMMAND} from "../shared/contracts";
import type {FocusSource} from "../shared/contracts";
import {createFocusStore, formatRemaining} from "./focus-store";

export const FOCUS_VIEW = `${descriptor.id}.panel`;
export const FOCUS_ITEM = `${descriptor.id}.status`;

const view = viewContribution({
    id: FOCUS_VIEW,
    // 侧栏默认宽约 240px：内容按窄宽写，`minimumSize` 给按钮与倒计时留出一行的宽度。
    declaration: {title: {"zh-CN": "专注计时", "en-US": "Focus timer"}, icon: "i-lucide-timer", location: "sidebar", layout: "scroll", minimumSize: {width: 200}},
    load: () => import("./FocusPanel.vue"),
});

/** 状态栏条目：点一下开始或放弃。条目的命令是静态的一条，所以要一条“切换”命令，而不是开始、放弃各挂一个。 */
const item: ContributionDeclaration<ItemDeclaration> = {
    capability: WORKBENCH_STATUSBAR_ITEMS_POINT,
    id: FOCUS_ITEM,
    declaration: {title: {"zh-CN": "专注计时", "en-US": "Focus timer"}, alignment: "right", order: 100, priority: 0, command: {id: TOGGLE_COMMAND}},
};

const NO_ARGS = Type.Object({}, {additionalProperties: false});

/**
 * 命令：进命令面板，有写入（`effect: "write"`）。`expose.agent: "never"`：开始、放弃计时是用户自己的节奏，不交给 Agent；
 * 想让 Agent 也能用，改成 `confirm`（每次问用户）或 `auto`。
 */
function command(id: string, zh: string, en: string, description: string): ContributionDeclaration<CommandDeclaration> {
    return {capability: COMMANDS_POINT, id, declaration: {title: {"zh-CN": `专注计时：${zh}`, "en-US": `Focus timer: ${en}`}, description, args: NO_ARGS, effect: "write", expose: {agent: "never"}}};
}

const commands = [
    command(START_COMMAND, "开始", "Start", "Start a focus session of the configured length"),
    command(CANCEL_COMMAND, "放弃", "Give up", "Give up the running focus session without counting it"),
    command(TOGGLE_COMMAND, "开始或放弃", "Start or give up", "Start a focus session, or give up the running one"),
];

export const focusBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: hostClockKey}],
        contributions: [view.contribution, item, ...commands],
        activate: (context) => {
            const sessions = context.remote.use(sessionsContract);
            const source: FocusSource = {
                today: () => sessions.today({}),
                start: () => sessions.start({}),
                cancel: () => sessions.cancel({}),
                subscribe: (listener, options) => sessions.events.changed.subscribe({}, listener, options),
            };
            const store = createFocusStore(source, context.services.require(hostClockKey));
            // 这一代收口时取消走表与订阅；订阅归本入口，内核也会结束它，这里先停走表。
            context.scope.register({kind: "focus-store", label: `${descriptor.id} 的窗口状态`, value: store, release: (value) => value.dispose()});
            // 不等第一份“今天”：激活不被网络卡住，拿到之前视图与条目显示“…”。
            void store.connect();

            const status: ItemImplementation = {
                text: () => {
                    const current = store.view.value;
                    if (!current.ready) return "…";
                    return current.running ? `专注 ${formatRemaining(current.remainingMs)}` : `今天 ${String(current.completed)} 个番茄`;
                },
                tooltip: () => (store.view.value.running ? "点一下放弃这次专注" : "点一下开始专注"),
                state: () => (store.view.value.problem === null ? "normal" : "warning"),
            };
            const run = (action: () => Promise<void>): CommandImplementation => ({run: async () => {
                await action();
                const problem = store.view.value.problem;
                return problem === null ? {ok: true, value: null} : {ok: false, code: "execution-error", reason: problem};
            }});
            return {contributions: {
                [WORKBENCH_VIEWS_POINT]: {[view.id]: view.implementation(() => ({store}))},
                [WORKBENCH_STATUSBAR_ITEMS_POINT]: {[FOCUS_ITEM]: status},
                [COMMANDS_POINT]: {[START_COMMAND]: run(store.start), [CANCEL_COMMAND]: run(store.cancel), [TOGGLE_COMMAND]: run(store.toggle)},
            }};
        },
    })],
};
