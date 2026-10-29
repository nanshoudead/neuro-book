/**
 * 组件里取文字的一步写法（docs/specs/ui/i18n.md 的“目录与键”）：绑定插件命名空间，返回 `(键, 参数) => 当前语言的字符串`。
 * 键按源语言目录核对，写错编译不过。读注入的端口，组件要在同名 `.md` 里声明 `state:inject`。
 *
 * 只给浏览器里的组件用（依赖 Vue 的注入）。要把文字引用交给别处翻译（声明、运行期条目、远程合同）时用 `pluginText`；
 * 不在组件里的纯 TS 函数收 `TextResolver`，用 `boundText` 绑定命名空间。
 */

import {useText} from "@notnotype/nb-ui/text-port";
import type {Catalog, TextParams} from "@notnotype/nb-ui/text";

import type {TextResolver} from "./localized-text";
import {pluginText} from "./plugin-text";
import type {CatalogKey} from "./plugin-text";

export type BoundText<Source = Catalog> = (key: CatalogKey<Source>, params?: TextParams) => string;

/** 在 `setup` 里调用。不写 `Source` 时键不核对。 */
export function usePluginText<Source = Catalog>(ns: string): BoundText<Source> {
    return boundText<Source>(useText(), ns);
}

export function boundText<Source = Catalog>(resolver: TextResolver, ns: string): BoundText<Source> {
    const reference = pluginText<Source>(ns);
    return (key, params) => resolver.t(reference(key, params));
}
