/**
 * 表单自己的文字的引用（docs/specs/ui/forms.md 输出 7、24）。文字在本包自带的目录里（`./locales`，命名空间 `nb-form`）；
 * 核心拿不到语言，只产出文字引用，由 Vue 层经翻译端口在显示时翻译。
 *
 * 核心对 nb-ui 只取类型（`src/boundary.test.ts`），所以引用按 `TextRef` 的形状直接写对象，不调用 nb-ui 的 `textRef`。
 */

import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

import {NB_FORM_NAMESPACE} from "./locales";
import type zhCN from "./locales/zh-CN";
import type {FormText} from "./text";
import type {FormIssue} from "./validate";

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
export type FormTextKey = CatalogKey<typeof zhCN>;

/** 本包目录里一条文字的引用；带数量的写 `count`。 */
export function formRef(key: FormTextKey, params?: TextParams): TextRef {
    return {kind: "text", ns: NB_FORM_NAMESPACE, key, ...(params === undefined ? {} : {params})};
}

/**
 * 参数照旧代码的 `String(...)` 写成字符串再交给目录：TypeBox 给的参数可能缺失或不是数字，交原值时测试环境的翻译会因
 * 缺参数抛错、界面会露出占位符，与迁移前显示的文字不同。
 */
const text = (value: unknown): string => String(value);

/** schema 问题按码写（输出 7）；`params` 是 TypeBox 给的参数（`limit`、`format` 等）。表里没有的码用 `fallback`。 */
const CODES: Readonly<Record<string, (params: Readonly<Record<string, unknown>>) => TextRef>> = {
    "required": () => formRef("codes.required"),
    "type": () => formRef("codes.type"),
    "min-length": (params) => formRef("codes.min-length", {limit: text(params.limit)}),
    "max-length": (params) => formRef("codes.max-length", {limit: text(params.limit)}),
    "pattern": () => formRef("codes.pattern"),
    "format": () => formRef("codes.format"),
    "minimum": (params) => formRef(params.comparison === ">" ? "codes.minimum-exclusive" : "codes.minimum", {limit: text(params.limit)}),
    "maximum": (params) => formRef(params.comparison === "<" ? "codes.maximum-exclusive" : "codes.maximum", {limit: text(params.limit)}),
    "multiple-of": (params) => formRef("codes.multiple-of", {multipleOf: text(params.multipleOf)}),
    "min-items": (params) => formRef("codes.min-items", {limit: text(params.limit)}),
    "max-items": (params) => formRef("codes.max-items", {limit: text(params.limit)}),
    "unique-items": () => formRef("codes.unique-items"),
    "not-in-choices": () => formRef("codes.not-in-choices"),
    "no-match": () => formRef("codes.no-match"),
    "unparseable": () => formRef("codes.unparseable"),
    "read-only": () => formRef("codes.read-only"),
    "schema-error": () => formRef("codes.schema-error"),
    "contains": () => formRef("codes.contains"),
    "min-contains": (params) => formRef("codes.min-contains", {limit: text(params.limit ?? params.minContains ?? "")}),
    "max-contains": (params) => formRef("codes.max-contains", {limit: text(params.limit ?? params.maxContains ?? "")}),
    "min-properties": (params) => formRef("codes.min-properties", {limit: text(params.limit)}),
    "max-properties": (params) => formRef("codes.max-properties", {limit: text(params.limit)}),
    "dependent-required": () => formRef("codes.dependent-required"),
    "dependent-schemas": () => formRef("codes.dependent-schemas"),
    "additional-property": (params) => (typeof params.key === "string" ? formRef("codes.additional-property", {key: params.key}) : formRef("codes.additional-property-unnamed")),
    "property-names": () => formRef("codes.property-names"),
    "one-of": () => formRef("codes.one-of"),
    "not": () => formRef("codes.not"),
    "if-then": () => formRef("codes.if-then"),
};

/**
 * 一条问题的文字，不含位置：调用方的问题用它自己的文字，schema 的问题按码写。用静态的码表判断有没有写法，不去问
 * 翻译端口：端口找不到键时返回键名或（测试环境）抛错，不能当作“没有写法”的判据。
 */
export function issueWording(issue: FormIssue): FormText {
    if (issue.message !== undefined) return issue.message;
    return Object.hasOwn(CODES, issue.code) ? CODES[issue.code]!(issue.params) : formRef("fallback", {code: issue.code});
}
