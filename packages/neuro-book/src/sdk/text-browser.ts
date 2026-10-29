/**
 * 插件 SDK 的 `/text/browser`：组件里把文字翻成当前语言（docs/specs/ui/i18n.md 的“目录与键”）。要 Vue，只给浏览器入口用。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 *
 * 读的是宿主在窗口的 Vue 根上注入的翻译端口：插件运行时这个子路径由宿主模块表给出宿主自己的那一份
 * （docs/specs/runtime/plugin-code-loading.md 输出 2），`useText()` 注入到的就是窗口的端口，切换界面语言时组件跟着换文字。
 * nb-ui 不发布，插件不能直接导入它的 `text-port`，只经这里取。
 */

export {useText} from "@notnotype/nb-ui/text-port";
export type {TextPort} from "@notnotype/nb-ui/text-port";

export {usePluginText} from "nbook/shared/use-plugin-text";
export type {BoundText} from "nbook/shared/use-plugin-text";
