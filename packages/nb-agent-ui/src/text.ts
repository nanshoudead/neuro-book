/**
 * 本包界面文字的引用（docs/specs/ui/i18n.md 的“目录与键”）。文字在本包自带的目录里（`./locales`，命名空间 `nb-agent-ui`）；
 * 核心（分轮规则、注册表、过程摘要、harness 适配器）拿不到语言，只产出文字引用，由 Vue 层经翻译端口在显示时翻译。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

import {NB_AGENT_UI_NAMESPACE} from "./locales";
import type zhCN from "./locales/zh-CN";
import type {LocalizedText} from "./types";

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
export type AgentTextKey = CatalogKey<typeof zhCN>;

/** 本包目录里一条文字的引用；带数量的写 `count`。 */
export function agentRef(key: AgentTextKey, params?: TextParams): TextRef {
    return textRef(key, params, NB_AGENT_UI_NAMESPACE);
}

function fill(template: string, params: TextParams): string {
    return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}

/** 宿主与插件写带参数的中英两份文字时用：两种语言各代入一次，占位写 `{name}`。 */
export function formatText(template: LocalizedText, params: TextParams): LocalizedText {
    return {"zh-CN": fill(template["zh-CN"], params), "en-US": fill(template["en-US"], params)};
}
