/**
 * nb-markdown 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方（nb-story 等）没开
 * `resolveJsonModule`，从包源码导入 JSON 会让它们的类型检查失败。
 *
 * 注入翻译端口的宿主在引导时按命名空间 `nb-markdown`、源语言 `zh-CN` 登记这份目录；没有宿主注入时，本包的组件用它与
 * nb-ui 的目录建缺省端口（`src/host/text.ts`）。
 *
 * 本模块不引 Vue：编辑器的装饰与展示器的静态视图（普通 DOM）也从这里取键的引用。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {Catalog, TextParams, TextRef} from "@notnotype/nb-ui/text";

import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_MARKDOWN_NAMESPACE = "nb-markdown";

/** 源语言；宿主登记目录时用。 */
export const NB_MARKDOWN_SOURCE_LOCALE = "zh-CN";

export const NB_MARKDOWN_CATALOGS: Readonly<Record<string, Catalog>> = {"zh-CN": zhCN, "en-US": enUS};

/** i18next 的复数形后缀：目录里写 `<键>_one`、`<键>_other`，引用写 `<键>` 加 `count` 参数。 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type WithoutPlural<Key extends string> = Key extends `${infer Base}_${PluralSuffix}` ? Base : Key;

/**
 * 目录推出的键：嵌套对象展开成点号路径，复数形归到不带后缀的键。与应用 `nbook/shared/plugin-text` 的 `CatalogKey` 写法
 * 相同；本包不能引用应用，所以各写一份。
 */
type CatalogKey<Source, Prefix extends string = ""> = {
    [Key in keyof Source & string]: Source[Key] extends string ? WithoutPlural<`${Prefix}${Key}`> : CatalogKey<Source[Key], `${Prefix}${Key}.`>;
}[keyof Source & string];

/** 本包目录里的键，按源语言（中文）目录核对，写错编译不过。 */
export type MarkdownTextKey = CatalogKey<typeof zhCN>;

/** 本包目录里一条文字的引用。 */
export function markdownRef(key: MarkdownTextKey, params?: TextParams): TextRef {
    return textRef(key, params, NB_MARKDOWN_NAMESPACE);
}
