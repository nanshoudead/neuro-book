/**
 * `nbook.settings` 的贡献助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：设置窗口左栏的 list 分区与设置项。SDK 的
 * `/settings` 导出它们，服务端也加载，不能引用 Vue；设置页与选项来源在 `settings-browser-helpers.ts`（`/settings/browser`）。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";
import type {Static, TSchema} from "typebox";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/sections";
import type {SettingsSectionCategory, SettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {defineSetting} from "nbook/shared/settings";
import type {SettingDefinition, SettingOptions} from "nbook/shared/settings";

import {contributionId, localizedText, recordDescribed} from "./plugin";
import type {PluginBuilder, Problem, ShortNameRule, Text} from "./plugin";

/** 设置项名在编辑器里就核对的部分：小驼峰（点分段），不写连字符、下划线与空格，不以大写开头。完整规则在加载时核对。 */
type SettingNameRule<Name extends string> = Name extends `${string}${"-" | "_" | " " | "/"}${string}`
    ? Problem<`设置项名用小驼峰（点分段）：${Name}`>
    : Name extends `${infer First}${string}` ? (First extends Lowercase<First> ? unknown : Problem<`设置项名用小驼峰（点分段）：${Name}`>) : unknown;

/** list 分区助手：设置项的 `section` 收它，`group` 只能是它的组 id。 */
export interface SectionHelper<Id extends string = string, Group extends string = string> {
    readonly id: Id;
    readonly contribution: ContributionDeclaration<SettingsSectionDeclaration> & {readonly capability: typeof SETTINGS_SECTIONS_POINT; readonly id: Id};
    /** 只在类型上：分区的组 id。 */
    readonly groups?: Group;
}

/** list 分区：设置窗口左栏的一项，窗口按设置项的 schema 画控件；`category` 缺省 `plugins`。写进 `plugin.descriptor([…])`。 */
export function section<const Id extends string, const Name extends string, const Group extends string = never>(plugin: PluginBuilder<Id>, options: {
    readonly name: Name;
    readonly title: Text;
    readonly description?: Text;
    readonly icon: string;
    readonly category?: SettingsSectionCategory;
    readonly order?: number;
    readonly groups?: ReadonlyArray<{readonly id: Group; readonly title: Text}>;
} & ShortNameRule<Name>): SectionHelper<`${Id}.${Name}`, Group> {
    const id = contributionId(plugin.id, options.name, "设置分区");
    const declaration: SettingsSectionDeclaration = {
        title: localizedText(options.title),
        ...(options.description === undefined ? {} : {description: localizedText(options.description)}),
        icon: options.icon,
        category: options.category ?? "plugins",
        ...(options.order === undefined ? {} : {order: options.order}),
        ...(options.groups === undefined ? {} : {groups: options.groups.map((group) => ({id: group.id, title: localizedText(group.title)}))}),
    };
    const contribution = {capability: SETTINGS_SECTIONS_POINT, id, declaration} as const;
    recordDescribed(plugin, "设置分区", contribution);
    return {id, contribution};
}

/**
 * 设置项；键是 `<插件 id>/<name>`。`section` 收分区助手（`group` 只能是它的组），引用别的插件的分区时写分区 id。写进
 * `plugin.descriptor([…])`。
 */
export function setting<const Id extends string, const Name extends string, Schema extends TSchema, const Section extends SectionHelper | string = never>(plugin: PluginBuilder<Id>, options: Omit<SettingOptions<Schema>, "plugin" | "name" | "title" | "description" | "section" | "group"> & {
    readonly name: Name;
    readonly title: Text;
    readonly description?: Text;
    readonly section?: Section;
    readonly group?: Section extends SectionHelper<string, infer Group> ? Group : string;
} & SettingNameRule<Name>): SettingDefinition<Static<Schema>> {
    const {title, description, section: owner, group, ...rest} = options;
    const definition = defineSetting({
        ...rest,
        plugin: plugin.id,
        title: localizedText(title),
        ...(description === undefined ? {} : {description: localizedText(description)}),
        ...(owner === undefined ? {} : {section: typeof owner === "string" ? owner : (owner as SectionHelper).id}),
        ...(group === undefined ? {} : {group}),
    } as SettingOptions<TSchema>);
    recordDescribed(plugin, "设置项", definition.contribution);
    return definition as never;
}
