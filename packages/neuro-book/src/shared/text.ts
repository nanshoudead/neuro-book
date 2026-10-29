/**
 * 声明与合同里文字值的 schema（docs/specs/ui/i18n.md 的“输入与前置条件”）。类型与判别在 nb-ui 的纯数据层；这里只给
 * TypeBox schema，因为 nb-ui 不依赖 TypeBox。schema 是纯 JSON Schema，第三方插件的贡献点也能用它校验。
 *
 * 语言标签的正则与 nb-ui 的 `isLocaleTag`（`Intl.getCanonicalLocales`）在常见写法上一致：主标签 2 到 3 个或 5 到 8 个
 * 字母，后跟子标签；4 个字母的主标签（例如 `kind`）不合法，所以 `TextRef` 不会同时满足语言映射的 schema。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {Text} from "@notnotype/nb-ui/text";

const LOCALE_TAG = "^(?:[A-Za-z]{2,3}|[A-Za-z]{5,8})(?:-[A-Za-z0-9]{1,8})*$";

export const LocaleMapSchema = Type.Record(Type.String({pattern: LOCALE_TAG}), Type.String(), {additionalProperties: false});

export const TextRefSchema = Type.Object({
    kind: Type.Literal("text"),
    ns: Type.Optional(Type.String({minLength: 1})),
    key: Type.String({pattern: "^[^:]+$"}),
    params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
}, {additionalProperties: false});

export const TextSchema = Type.Union([Type.String(), TextRefSchema, LocaleMapSchema]);

/** schema 推出的类型与 nb-ui 的 `Text` 必须一致；不一致时这里编译失败。 */
const _sameShape: (value: Static<typeof TextSchema>) => Text = (value) => value;
void _sameShape;
