/**
 * 包一个贡献的组件：宿主创建它时只传 `context`，组件还要的属性（例如贡献方插件自己的服务）由这里补上。组件里不能解析服务，
 * 所以服务由入口激活时拿到、经 `props` 传给组件。设置窗口的 page 分区与工作台的视图共用它。
 *
 * 放在 `ui/` 而不是某个插件的 `web/contracts.ts`：插件只能在运行时引用别的插件的 `shared/contracts.ts`，`ui/` 是宿主与插件
 * 共用的前端代码。
 */

import {defineComponent, h} from "vue";
import type {Component} from "vue";

/**
 * `load` 取组件，可以直接写 `() => import("./X.vue")`；`props` 在渲染时求值，读响应式的值时组件随之更新。组件声明
 * `context` 与 `props` 给的属性。
 */
export function boundComponent(name: string, load: () => Promise<Component | {readonly default: Component}>, props: () => Readonly<Record<string, unknown>> = () => ({})): {load(): Promise<Component>} {
    return {
        load: async () => {
            const loaded = await load();
            const component = typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : loaded;
            return defineComponent({
                name,
                props: {context: {type: Object, required: true}},
                setup: (own) => () => h(component, {...props(), context: own.context}),
            });
        },
    };
}
