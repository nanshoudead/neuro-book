/**
 * 表单里的文字（docs/specs/ui/forms.md“输入与前置条件”）：就是 nb-ui 的文字值 `Text`（docs/specs/ui/i18n.md）——单语
 * 字符串、目录里的键（`TextRef`），或按语言给出的文字（`LocaleMap`）。不依赖应用包：nbdev 面板与模型生成的描述都只给
 * 字符串。
 *
 * 核心没有目录，翻不了 `TextRef`：`resolveText` 只解析字符串与语言映射，引用由 Vue 层经翻译端口翻译（`vue/text.ts`）。
 * 核心对 nb-ui 只取类型（`src/boundary.test.ts`），所以判别与 schema 在这里各写一份，形状与 nb-ui 的 `isTextRef`、应用
 * 的 `TextRefSchema` 相同。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {Text, TextRef} from "@notnotype/nb-ui/text";

/** 目录里的一个键，形状同应用 `src/shared/text.ts` 的 `TextRefSchema`：应用的声明接受的引用，这里也接受。 */
const TextRefSchema = Type.Object({
    kind: Type.Literal("text"),
    ns: Type.Optional(Type.String({minLength: 1})),
    key: Type.String({pattern: "^[^:]+$"}),
    params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
}, {additionalProperties: false});

/**
 * 文字的形状：`x-form` 的文字提示与布局分组的标题都按它检查。语言映射一支不核对语言标签：以前合法的描述（键不是标准
 * 标签的映射）仍然合法。
 */
export const FormTextSchema = Type.Union([Type.String(), TextRefSchema, Type.Record(Type.String(), Type.String(), {minProperties: 1})]);

export type FormText = Text;

/** schema 推出的类型必须是 nb-ui 的 `Text`；不一致时这里编译失败。 */
const _sameShape: (value: Static<typeof FormTextSchema>) => FormText = (value) => value;
void _sameShape;

/** 回退的语言：语言映射里所给语言没有时取它，再没有取第一种。 */
export const FALLBACK_LOCALE = "en-US";

/**
 * 判别写法同 nb-ui 的 `isTextRef`。不带参数的引用 `{kind: "text", key}` 也满足宽松的语言映射一支，所以先判它：否则会取到
 * `kind` 的值。
 */
function isRef(text: FormText): text is TextRef {
    return typeof text === "object" && (text as {kind?: unknown}).kind === "text" && typeof (text as {key?: unknown}).key === "string";
}

/**
 * 字符串与语言映射的显示文字。`TextRef` 在核心里翻不了，返回键名作兜底；界面上的文字由 Vue 层经翻译端口翻译，不走
 * 这里。
 */
export function resolveText(text: FormText | undefined, locale: string): string {
    if (text === undefined) return "";
    if (typeof text === "string") return text;
    if (isRef(text)) return text.key;
    return text[locale] ?? text[FALLBACK_LOCALE] ?? Object.values(text)[0] ?? "";
}

export function isFormText(value: unknown): value is FormText {
    return Value.Check(FormTextSchema, value);
}

/** 文字是不是目录里的键（核心量不出它的长度，例如分段控件的名字长度）。 */
export function isFormTextRef(text: FormText): text is TextRef {
    return isRef(text);
}
