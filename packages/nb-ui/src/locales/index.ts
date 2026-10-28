/**
 * nb-ui 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方（nb-story、开发者面板等）没开
 * `resolveJsonModule`，从包源码导入 JSON 会让它们的类型检查失败。宿主在引导时按包名 `nb-ui` 登记这份目录。
 */

import type {Catalog, TextParams, TextRef} from "../text";
import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_UI_NAMESPACE = "nb-ui";

export const NB_UI_CATALOGS: Readonly<Record<string, Catalog>> = {"zh-CN": zhCN, "en-US": enUS};

/** i18next 的复数形后缀：目录里写 `<键>_one`、`<键>_other`，引用写 `<键>` 加 `count` 参数。 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type WithoutPlural<Key extends string> = Key extends `${infer Base}_${PluralSuffix}` ? Base : Key;

/** 目录推出的键：嵌套对象展开成点号路径，复数形归到不带后缀的键。 */
type CatalogKey<Source, Prefix extends string = ""> = {
    [Key in keyof Source & string]: Source[Key] extends string ? WithoutPlural<`${Prefix}${Key}`> : CatalogKey<Source[Key], `${Prefix}${Key}.`>;
}[keyof Source & string];

/** nb-ui 目录里的键，按源语言（中文）目录核对，写错编译不过。 */
export type NbUiTextKey = CatalogKey<typeof zhCN>;

/** nb-ui 目录里一条文字的引用；带数量的写 `count`。 */
export function uiRef(key: NbUiTextKey, params?: TextParams): TextRef {
    return {kind: "text", ns: NB_UI_NAMESPACE, key, ...(params === undefined ? {} : {params})};
}
