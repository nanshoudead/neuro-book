/**
 * SDK 的子路径表（docs/specs/runtime/plugin-api.md 的“SDK”）：SDK 有哪些子路径、各自的源文件、服务端能不能用，只写在这里。
 * 宿主模块表的名单、构建预设的外部引用、Vite 与示例构建的别名、打包出的 SDK 包的 `exports` 都由它生成。tsconfig 的路径别名
 * 写不成计算的，`sdk.test.ts` 把两份 tsconfig 与这张表对照。
 *
 * 纯数据、不导入任何东西：Vite 配置、构建脚本与平台档案都读它。每加一个子路径都是 `engines.neurobook` 兼容范围内的承诺。
 */

export const SDK_NAME = "@notnotype/nb-plugin-sdk";

export const SDK_ENTRIES = [
    /** 各运行位置通用的部分。 */
    {specifier: "@notnotype/nb-plugin-sdk", subpath: ".", file: "index.ts", server: true},
    /** 要 Vue 或 DOM 的部分，只在浏览器入口里用。 */
    {specifier: "@notnotype/nb-plugin-sdk/browser", subpath: "./browser", file: "browser.ts", server: false},
    /** nb-ui 的组件，只在浏览器入口里用。 */
    {specifier: "@notnotype/nb-plugin-sdk/components", subpath: "./components", file: "components.ts", server: false},
] as const;

export type SdkEntry = (typeof SDK_ENTRIES)[number];
