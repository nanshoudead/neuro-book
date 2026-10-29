/**
 * 浏览器入口：一个侧栏视图、一条命令。入口激活时拿到设置服务，经视图的属性交给视图组件（组件里不能解析服务）。
 */

import {ref} from "vue";

import {settingsKey} from "@notnotype/nb-plugin-sdk/settings";
import {command} from "@notnotype/nb-plugin-sdk/commands";
import {view} from "@notnotype/nb-plugin-sdk/workbench";

import {greeting, plugin} from "../shared/contracts";

/**
 * 侧栏视图；第一次显示时才加载组件。`location` 缺省侧栏、`layout` 缺省 `scroll`。标题与下面命令的标题不写，取消息目录里的
 * 约定键 `views.hello.title`、`commands.say-hello.title`（见 `../shared/contracts.ts`）。
 */
const hello = view(plugin, {name: "hello", icon: "i-lucide-hand", load: () => import("./HelloView.vue")});

const sayHello = command(plugin, {
    name: "say-hello",
    // 给 Agent 看的说明，用英文写。
    description: "Count one more greeting in the __DISPLAY_NAME__ view",
    // 会改状态（这里是计数）就是 `write`：只读模式下 Agent 不能执行它。没有参数，`args` 不用写。
    effect: "write",
});

export const browserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    // 窗口启动就激活：视图的实现要等入口激活才交出，不激活视图就只有标题、没有内容。代价是每个窗口启动时都下载并执行
    // 这个入口；只在某处用到的功能，换成那里的激活事件（例如设置页助手自带的激活事件）。
    activationEvents: ["onStartup"],
    dependencies: [{key: settingsKey}],
    // 键随你取，激活产出里用同样的键交实现：漏写、多写、交错了都编译不过。
    contributions: {hello, sayHello},
    activate: (context) => {
        const settings = context.services.require(settingsKey);
        const count = ref(0);
        const greet = (): number => (count.value += 1);
        return {contributions: {
            // 属性在渲染时求值：读到的设置与计数变化时，视图跟着更新。属性名与组件的 `defineProps` 对不上时 `bun run typecheck` 报错。
            hello: hello.implement(() => ({greeting: settings.get(greeting), count: count.value, sayHello: () => void greet()})),
            sayHello: sayHello.implement(() => ({ok: true, value: greet()})),
        }};
    },
})]);
