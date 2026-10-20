/**
 * 设置分区的两个贡献点的声明与登记校验（docs/specs/settings/settings-window.md“分区声明”）：
 *
 * - `settings.sections`：list 分区，顶层声明式贡献，没有实现；三个位置都登记，所以校验函数只看声明，不看位置。
 * - `settings.pages`：page 分区，只接受浏览器入口的贡献；实现（`load()`）与页面上下文依赖 Vue，在 `web/contracts.ts`。
 *
 * 两个点上的 id 规则相同；同一 id 出现在两个点上由设置窗口查（内核只在一个点内去重）。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";
import {isSettingsGroupId, isSettingsSectionId, SETTINGS_ORDER_LIMIT, SETTINGS_SECTION_ID_MAX_LENGTH} from "nbook/shared/settings";

export const SETTINGS_SECTIONS_POINT = "settings.sections";
export const SETTINGS_PAGES_POINT = "settings.pages";

/** `nbook.settings` 拥有的激活事件前缀：设置窗口显示一个 page 分区时触发 `onSettingsPage:<分区 id>`。 */
export const SETTINGS_PAGE_ACTIVATION_PREFIX = "onSettingsPage";

/** page 分区的贡献方入口写进 `activationEvents` 的事件：设置窗口显示这个分区时才激活入口。 */
export function settingsPageEvent(sectionId: string): string {
    return `${SETTINGS_PAGE_ACTIVATION_PREFIX}:${sectionId}`;
}

/** 左栏的三组，自上而下：应用、AI、插件。 */
export const SETTINGS_SECTION_CATEGORIES = ["app", "ai", "plugins"] as const;

export type SettingsSectionCategory = (typeof SETTINGS_SECTION_CATEGORIES)[number];

const Layer = Type.Union([Type.Literal("user"), Type.Literal("project")]);

/** 两种分区共有的字段：左栏怎样列出它。 */
const heading = {
    title: LocalizedTextSchema,
    description: Type.Optional(LocalizedTextSchema),
    icon: Type.String({pattern: "\\S"}),
    category: Type.Union([Type.Literal("app"), Type.Literal("ai"), Type.Literal("plugins")]),
    order: Type.Optional(Type.Number({minimum: -SETTINGS_ORDER_LIMIT, maximum: SETTINGS_ORDER_LIMIT})),
};

export const SettingsSectionDeclarationSchema = Type.Object({
    ...heading,
    groups: Type.Optional(Type.Array(Type.Object({id: Type.String(), title: LocalizedTextSchema}, {additionalProperties: false}))),
}, {additionalProperties: false});

export const SettingsPageDeclarationSchema = Type.Object({
    ...heading,
    layout: Type.Optional(Type.Union([Type.Literal("column"), Type.Literal("fill")])),
    layers: Type.Optional(Type.Array(Layer, {minItems: 1})),
}, {additionalProperties: false});

/** list 分区的声明（`settings.sections`）。 */
export type SettingsSectionDeclaration = Static<typeof SettingsSectionDeclarationSchema>;
/** page 分区的声明（`settings.pages`）。 */
export type SettingsPageDeclaration = Static<typeof SettingsPageDeclarationSchema>;

/** id 的形状与前缀：内置插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头（同视图）。 */
function idProblem(descriptor: ContributionDescriptor): string | null {
    const id = descriptor.id;
    if (!isSettingsSectionId(id)) return `分区 id 必须是点分的小写段、至多 ${String(SETTINGS_SECTION_ID_MAX_LENGTH)} 个字符：${id}`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的分区 id 必须以 ${prefix} 开头：${id}`;
    return null;
}

function shapeProblem(schema: TSchema, descriptor: ContributionDescriptor): string | null {
    if (Value.Check(schema, descriptor.declaration)) return null;
    const first = [...Value.Errors(schema, descriptor.declaration)][0];
    return `分区 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
}

/** `settings.sections` 的登记校验：只看这一条声明本身；配置项指向的分区与小组存不存在不在这里核对。 */
export function validateSectionContribution(descriptor: ContributionDescriptor): string | null {
    const problem = idProblem(descriptor) ?? shapeProblem(SettingsSectionDeclarationSchema, descriptor);
    if (problem !== null) return problem;
    const ids = ((descriptor.declaration as SettingsSectionDeclaration).groups ?? []).map((group) => group.id);
    const malformed = ids.find((group) => !isSettingsGroupId(group));
    if (malformed !== undefined) return `分区 ${descriptor.id} 的小组 id 必须是一个小写段：${malformed}`;
    if (new Set(ids).size !== ids.length) return `分区 ${descriptor.id} 的小组 id 有重复`;
    return null;
}

/** `settings.pages` 的登记校验：只接受浏览器入口的贡献。 */
export function validatePageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${SETTINGS_PAGES_POINT} 只接受浏览器入口的贡献`;
    const problem = idProblem(descriptor) ?? shapeProblem(SettingsPageDeclarationSchema, descriptor);
    if (problem !== null) return problem;
    const layers = (descriptor.declaration as SettingsPageDeclaration).layers;
    if (layers !== undefined && new Set(layers).size !== layers.length) return `分区 ${descriptor.id} 的 layers 有重复`;
    return null;
}
