/**
 * 宿主与第三方插件共享的模块（docs/specs/runtime/plugin-code-loading.md 输出 2–5）：插件构建时把它们留作外部引用，运行时
 * 由宿主给出自己的那一份。构建预设（`scripts/plugin-sdk/build-plugin.ts`）与两端的装载器读同一张表，表外的引用在构建时就
 * 报“未共享”，不必等到运行时才得到 `module-not-shared`。
 *
 * 每加一项都是 `engines.neurobook` 兼容范围内的承诺。Vue 与 `@vue/reactivity` 必须共享同一份：两份响应式系统互相看不见，
 * `computed` 不更新、`watch` 不触发，也不报错。
 */

/**
 * 浏览器入口的宿主模块表。nb-ui 的组件经 SDK 的 `components` 子路径共享，不共享 `@notnotype/nb-ui/components`：nb-ui 不发布，
 * 作者只能从 SDK 包拿到组件的构建期实现与类型。
 */
export const BROWSER_SHARED_MODULES = ["vue", "@vue/reactivity", "@notnotype/nb-plugin-sdk", "@notnotype/nb-plugin-sdk/browser", "@notnotype/nb-plugin-sdk/components"] as const;

/**
 * 服务端与项目实例入口的宿主模块；Node 与 Bun 的内置模块另外允许。不含 `vue`：后端不加载界面框架，服务端代码要响应式就从
 * `@vue/reactivity` 取（与宿主的插件状态 store 同一份）。
 */
export const SERVER_SHARED_MODULES = ["@vue/reactivity", "@notnotype/nb-plugin-sdk"] as const;

/**
 * 浏览器产物登记工厂用的全局对象名。脚本执行时调用 `globalThis[名].register(脚本 URL, factory)`，`factory(module, exports,
 * require)` 才是 CommonJS 模块体；宿主每次激活入口调用一次工厂（plugin-code-loading.md 输出 1、2）。
 */
export const PLUGIN_REGISTRY_GLOBAL = "__NBOOK_PLUGIN_REGISTRY__";
