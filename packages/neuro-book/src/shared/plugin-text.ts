/**
 * 按插件 id 绑定命名空间的取文字辅助函数（docs/specs/ui/i18n.md 的“目录与键”）：代码里直接构造文字引用时用它，引用带上
 * 命名空间、键按目录的类型核对。声明里的文字不用它：没写命名空间的引用由宿主登记时补上（约定键）。运行期的文字
 * （状态栏条目的 `text()` 这类）不经登记，必须自己带命名空间，所以要用它。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {Catalog, TextParams, TextRef} from "@notnotype/nb-ui/text";

/** i18next 的复数形后缀：目录里写 `<键>_one`、`<键>_other`，引用写 `<键>` 加 `count` 参数。 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type WithoutPlural<Key extends string> = Key extends `${infer Base}_${PluralSuffix}` ? Base : Key;

/**
 * 源语言目录推出的键：嵌套对象展开成点号路径，复数形归到不带后缀的键。传宽泛的 `Catalog`（键是 `string`）时退化成
 * `string`，不做核对。
 */
export type CatalogKey<Source, Prefix extends string = ""> = string extends keyof Source
    ? string
    : {
        [Key in keyof Source & string]: Source[Key] extends string ? WithoutPlural<`${Prefix}${Key}`> : CatalogKey<Source[Key], `${Prefix}${Key}.`>;
    }[keyof Source & string];

/**
 * 返回绑定了命名空间 `ns`（插件 id）的引用构造函数。`Source` 写源语言目录的类型（例如 `typeof import("./locales/zh-CN.json")`）
 * 时，键写错编译不过；参数名推不出来，不在这里核对。
 */
export function pluginText<Source = Catalog>(ns: string): (key: CatalogKey<Source>, params?: TextParams) => TextRef {
    return (key, params) => textRef(key, params, ns);
}
