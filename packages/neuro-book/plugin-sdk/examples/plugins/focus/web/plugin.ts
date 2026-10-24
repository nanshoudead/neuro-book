/**
 * `example.focus` 的浏览器入口：侧栏视图、状态栏条目与三条命令。读这个文件学三件事：
 *
 * 1. **启动即激活**：视图与状态栏条目的实现都在入口激活时交出，不激活，状态栏就没有这一项、视图只有标题（docs/specs/ui/
 *    workbench-shell.md 的状态栏条目、docs/specs/workbench/views.md）。代价是每个窗口启动时都下载、执行这个入口；只在某处才用
 *    到的功能，换成那里的激活事件。
 * 2. **以自己的身份调用自己的服务端**：`context.remote.use(合同)`，合同写在服务端入口的 `remoteProvides` 里、`callers` 含
 *    browser。状态放在 `focus-store.ts`，视图、条目、命令都读它。
 * 3. **把服务交给视图组件**：组件里不能解析服务，视图助手的 `implement(props)` 在渲染时求值，把 store 交过去；属性名与
 *    组件的 `defineProps` 对不上时类型检查报错。
 *
 * 对应的场景：`scenarios/07-focus.test.ts`；组件测试：`FocusPanel.dom.test.ts`。
 */

import {hostClockKey} from "@notnotype/nb-plugin-sdk";
import type {CommandResult} from "@notnotype/nb-plugin-sdk/commands";
import {statusItem, view} from "@notnotype/nb-plugin-sdk/workbench";

import {cancelCommand, plugin, sessionsContract, startCommand, toggleCommand} from "../shared/contracts";
import type {FocusSource} from "../shared/contracts";
import {createFocusStore, formatRemaining} from "./focus-store";

/** 侧栏视图。侧栏默认宽约 240px：内容按窄宽写，`minimumSize` 给按钮与倒计时留出一行的宽度。 */
const panel = view(plugin, {name: "panel", title: {"zh-CN": "专注计时", "en-US": "Focus timer"}, icon: "i-lucide-timer", minimumSize: {width: 200}, load: () => import("./FocusPanel.vue")});

/** 状态栏条目：点一下开始或放弃（挂“切换”命令）；靠右是缺省，`order` 排在内置条目之间。 */
const status = statusItem(plugin, {name: "status", title: {"zh-CN": "专注计时", "en-US": "Focus timer"}, order: 100, command: toggleCommand});

export const FOCUS_VIEW = panel.id;
export const FOCUS_ITEM = status.id;

export const focusBrowserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: hostClockKey}],
    contributions: {panel, status, start: startCommand, cancel: cancelCommand, toggle: toggleCommand},
    activate: (context) => {
        const sessions = context.remote.use(sessionsContract);
        const source: FocusSource = {
            today: () => sessions.today({}),
            start: () => sessions.start({}),
            cancel: () => sessions.cancel({}),
            subscribe: (listener, options) => sessions.events.changed.subscribe({}, listener, options),
        };
        const store = createFocusStore(source, context.services.require(hostClockKey));
        // 这一代收口时停走表、释放订阅。订阅随入口停止自动结束，重复释放无害。
        context.onStop(() => store.dispose());
        // 不等第一份“今天”：激活不被网络卡住，拿到之前视图与条目显示“…”。
        void store.connect();

        const run = (action: () => Promise<void>) => async (): Promise<CommandResult<null>> => {
            await action();
            const problem = store.view.value.problem;
            return problem === null ? {ok: true, value: null} : {ok: false, code: "execution-error", reason: problem};
        };
        return {contributions: {
            panel: panel.implement(() => ({store})),
            status: status.implement({
                text: () => {
                    const current = store.view.value;
                    // 读不到时不停在“…”：状态是警告，打开视图能看到原因与“重新同步”。
                    if (!current.ready) return current.problem === null ? "…" : "专注：读不到";
                    return current.running ? `专注 ${formatRemaining(current.remainingMs)}` : `今天 ${String(current.completed)} 个番茄`;
                },
                tooltip: () => (store.view.value.running ? "点一下放弃这次专注" : "点一下开始专注"),
                state: () => (store.view.value.problem === null ? "normal" : "warning"),
            }),
            start: startCommand.implement(run(store.start)),
            cancel: cancelCommand.implement(run(store.cancel)),
            toggle: toggleCommand.implement(run(store.toggle)),
        }};
    },
})]);
