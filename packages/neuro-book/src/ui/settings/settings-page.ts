/**
 * 包一个 page 分区的实现（docs/specs/settings/settings-window.md“分区声明”）：设置窗口创建页面时只传 `context`，页面还要的
 * 属性（例如本插件自己的配置服务）由这里补上。页面组件里不能解析服务，所以服务由入口激活时拿到、经这里传给页面。
 *
 * 放在 `ui/` 而不是 `nbook.settings` 的 `web/contracts.ts`：插件只能在运行时引用别的插件的 `shared/contracts.ts`，`ui/`
 * 是宿主与插件共用的前端代码。返回值按结构写，就是 `SettingsPageImplementation`。
 */

import {defineComponent, h} from "vue";
import type {Component} from "vue";

/**
 * `load` 取页面组件，可以直接写 `() => import("./Page.vue")`；`props` 在渲染时求值，读响应式的值时页面随之更新。页面
 * 组件声明 `context` 与 `props` 给的属性。
 */
export function settingsPage(load: () => Promise<Component | {readonly default: Component}>, props: () => Readonly<Record<string, unknown>> = () => ({})): {load(): Promise<Component>} {
    return {
        load: async () => {
            const loaded = await load();
            const page = typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : loaded;
            return defineComponent({
                name: "SettingsPage",
                props: {context: {type: Object, required: true}},
                setup: (own) => () => h(page, {...props(), context: own.context}),
            });
        },
    };
}
