/**
 * 插件 SDK 的 `/text`：界面文字的值与插件自己的文字引用（docs/specs/ui/i18n.md、docs/specs/runtime/plugin-api.md 的“作者 API”）。
 * 纯数据，不引 Vue，服务端入口也能用。组件里把文字翻成当前语言用只给浏览器的 `/text/browser`。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

// 文字值的三种形态：不翻译的字符串、语言映射、目录里的键。助手的文字字段、运行期条目的 `text()` 都收它。
export type {LocaleMap, Text, TextParams, TextRef} from "@notnotype/nb-ui/text";

// 代码里自己构造文字引用（状态栏条目的 `text()`、交给通知的标题）：绑定插件 id 作命名空间，传源语言目录的类型时键写错编译不过。
export {pluginText} from "nbook/shared/plugin-text";
export type {CatalogKey} from "nbook/shared/plugin-text";
