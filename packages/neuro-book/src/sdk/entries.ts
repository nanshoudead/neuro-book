/**
 * SDK 的子路径表（docs/specs/runtime/plugin-api.md 的“SDK”）：SDK 有哪些子路径、各自的源文件、服务端能不能用，只写在这里。
 * 宿主模块表的名单、构建预设的外部引用、Vite 与示例构建的别名、打包出的 SDK 包的 `exports` 都由它生成。tsconfig 的路径别名
 * 写不成计算的，`sdk.test.ts` 把两份 tsconfig 与这张表对照。
 *
 * 纯数据、不导入任何东西：Vite 配置、构建脚本与平台档案都读它。每加一个子路径都是 `engines.neurobook` 兼容范围内的承诺。
 *
 * 分法：根入口是插件框架，其余按内置插件各占一个子路径，从导入路径就看得出在用哪个内置插件。要 Vue 的部分：整个内置插件
 * 只在浏览器里有意义的（工作台）占一个只给浏览器的子路径；两端都要的（设置）把浏览器部分放在 `/<插件>/browser`。
 */

export const SDK_NAME = "@notnotype/nb-plugin-sdk";

export const SDK_ENTRIES = [
    /** 插件框架：`definePlugin`、内核的入口、服务、远程服务、诊断与宿主能力。 */
    {specifier: "@notnotype/nb-plugin-sdk", subpath: ".", file: "index.ts", server: true},
    /** `nbook.state`：插件状态与公开状态。 */
    {specifier: "@notnotype/nb-plugin-sdk/state", subpath: "./state", file: "state.ts", server: true},
    /** `nbook.storage`：私有存储。 */
    {specifier: "@notnotype/nb-plugin-sdk/storage", subpath: "./storage", file: "storage.ts", server: true},
    /** `nbook.settings`：设置项与 list 分区。 */
    {specifier: "@notnotype/nb-plugin-sdk/settings", subpath: "./settings", file: "settings.ts", server: true},
    /** `nbook.settings` 只在浏览器里有意义的部分：设置页、选项来源与设置页组件。 */
    {specifier: "@notnotype/nb-plugin-sdk/settings/browser", subpath: "./settings/browser", file: "settings-browser.ts", server: false},
    /** `nbook.commands`：命令与命令服务。 */
    {specifier: "@notnotype/nb-plugin-sdk/commands", subpath: "./commands", file: "commands.ts", server: true},
    /** `nbook.workbench`：视图与状态栏条目；工作台只在浏览器里。 */
    {specifier: "@notnotype/nb-plugin-sdk/workbench", subpath: "./workbench", file: "workbench.ts", server: false},
    /** nb-ui 的组件，只在浏览器入口里用。 */
    {specifier: "@notnotype/nb-plugin-sdk/components", subpath: "./components", file: "components.ts", server: false},
] as const;

export type SdkEntry = (typeof SDK_ENTRIES)[number];
