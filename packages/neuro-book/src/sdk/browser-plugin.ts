/**
 * 作者 API 里只在浏览器入口用的贡献助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：视图、设置页、状态栏条目与选项
 * 来源。它们要 Vue 或只在窗口里有意义，所以不在 `definePlugin` 的对象上（根入口服务端也加载），第一个参数是 `plugin`，
 * 读它的 id 拼贡献 id；带 `where: "browser"`，写进别的位置的入口编译不过。
 */

import type {AllowedComponentProps, Component, ComponentCustomProps, MaybeRefOrGetter, VNodeProps} from "vue";

import type {OptionSource} from "@notnotype/nb-form";

import {SETTINGS_CHOICES_POINT, settingsChoicesEvent} from "nbook/plugins/settings/shared/sections";
import type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import type {SettingsChoicesImplementation} from "nbook/plugins/settings/web/contracts";
import {settingsPageContribution} from "nbook/plugins/settings/web/page-contribution";
import {WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation} from "nbook/plugins/workbench/web/contracts";
import {viewContribution} from "nbook/plugins/workbench/web/view-contribution";

import {bound, contributionId, localizedText} from "./plugin";
import type {BoundImplementation, CommandHelper, ContributionHelper, PluginBuilder, Text} from "./plugin";

/** `load` 取到的组件。 */
type Loaded<Load> = Load extends () => Promise<infer Module> ? (Module extends {readonly default: infer Value} ? Value : Module) : never;

/**
 * 组件的属性类型，去掉宿主给的 `context` 与 Vue 给每个组件都加的属性。用 vue-tsc 检查时，`load: () => import("./X.vue")`
 * 带着组件的 `defineProps`，`implement` 给的属性漏了必填项、写错名或类型不对都编译不过；可选属性的笔误查不出（返回的对象
 * 不做多余属性检查）。带泛型参数的单文件组件（`<script setup generic="…">`）推不出属性，回落成不检查。只有 tsc 时单文件组件
 * 是没有属性信息的 `Component`，不检查也不误报。
 */
export type PropsOf<Load> = Loaded<Load> extends abstract new (...args: never) => {readonly $props: infer Props}
    ? Omit<Props, keyof VNodeProps | keyof AllowedComponentProps | keyof ComponentCustomProps | "context">
    : Readonly<Record<string, unknown>>;

type ComponentLoad = () => Promise<Component | {readonly default: Component}>;

export interface ViewHelper<Id extends string, Load extends ComponentLoad> extends ContributionHelper<typeof WORKBENCH_VIEWS_POINT, Id, ViewDeclaration> {
    readonly where: "browser";
    /** `props` 在渲染时求值、作为视图组件的属性，读响应式的值时视图随之更新。组件另收宿主给的 `context`。 */
    implement(props?: () => PropsOf<Load>): BoundImplementation<typeof WORKBENCH_VIEWS_POINT, Id>;
}

/**
 * 侧栏、右栏或面板里的视图（docs/specs/workbench/views.md）：`location` 缺省 `sidebar`，`layout` 缺省 `scroll`。视图的实现要等
 * 入口激活才交出，入口通常写 `activationEvents: ["onStartup"]`。
 */
export function view<const Id extends string, const Name extends string, const Load extends ComponentLoad>(plugin: PluginBuilder<Id>, options: Omit<ViewDeclaration, "title" | "location" | "layout"> & {
    readonly name: Name;
    readonly title: Text;
    readonly location?: ViewDeclaration["location"];
    readonly layout?: ViewDeclaration["layout"];
    readonly load: Load;
}): ViewHelper<`${Id}.${Name}`, Load> {
    const id = contributionId(plugin.id, options.name, "视图");
    const {name: _name, title, location, layout, load, ...rest} = options;
    const helper = viewContribution({id, declaration: {...rest, title: localizedText(title), location: location ?? "sidebar", layout: layout ?? "scroll"}, load});
    return {
        id,
        contribution: helper.contribution,
        where: "browser",
        activationEvents: [],
        implement: (props) => bound(WORKBENCH_VIEWS_POINT, id, helper.implementation(props as (() => Readonly<Record<string, unknown>>) | undefined)),
    };
}

export interface SettingsPageHelper<Id extends string, Load extends ComponentLoad> extends ContributionHelper<"settings.pages", Id, SettingsPageDeclaration> {
    readonly where: "browser";
    implement(props?: () => PropsOf<Load>): BoundImplementation<"settings.pages", Id>;
}

/**
 * 设置窗口的 page 分区：插件自己画页面，每一项用 `SettingsRow` 排。`category` 缺省 `plugins`。设置窗口第一次显示这个分区时
 * 才激活入口：激活事件由 `plugin.entry` 自动并入。
 */
export function settingsPage<const Id extends string, const Name extends string, const Load extends ComponentLoad>(plugin: PluginBuilder<Id>, options: Omit<SettingsPageDeclaration, "title" | "description" | "category" | "keywords"> & {
    readonly name: Name;
    readonly title: Text;
    readonly description?: Text;
    readonly category?: SettingsPageDeclaration["category"];
    readonly keywords?: ReadonlyArray<Text>;
    readonly load: Load;
}): SettingsPageHelper<`${Id}.${Name}`, Load> {
    const id = contributionId(plugin.id, options.name, "设置页");
    const {name: _name, title, description, category, keywords, load, ...rest} = options;
    const helper = settingsPageContribution({
        id,
        declaration: {
            ...rest,
            title: localizedText(title),
            ...(description === undefined ? {} : {description: localizedText(description)}),
            category: category ?? "plugins",
            ...(keywords === undefined ? {} : {keywords: keywords.map(localizedText)}),
        },
        load,
    });
    return {
        id,
        contribution: helper.contribution,
        where: "browser",
        activationEvents: [helper.activationEvent],
        implement: (props) => bound(helper.contribution.capability, id, helper.implementation(props as (() => Readonly<Record<string, unknown>>) | undefined)),
    };
}

export interface StatusItemHelper<Id extends string> extends ContributionHelper<typeof WORKBENCH_STATUSBAR_ITEMS_POINT, Id, ItemDeclaration> {
    readonly where: "browser";
    /** 三个函数每次渲染都调用，从响应式状态现算。 */
    implement(implementation: ItemImplementation): BoundImplementation<typeof WORKBENCH_STATUSBAR_ITEMS_POINT, Id>;
}

/**
 * 状态栏条目（docs/specs/ui/workbench-shell.md 外壳四）：`alignment` 缺省 `right`，`order`、`priority` 缺省 0；`command`
 * 收命令助手（点击执行它，不带参数）或 `{id, args}`。
 */
export function statusItem<const Id extends string, const Name extends string>(plugin: PluginBuilder<Id>, options: Omit<ItemDeclaration, "title" | "alignment" | "order" | "priority" | "command"> & {
    readonly name: Name;
    readonly title: Text;
    readonly alignment?: ItemDeclaration["alignment"];
    readonly order?: number;
    readonly priority?: number;
    readonly command?: CommandHelper | NonNullable<ItemDeclaration["command"]>;
}): StatusItemHelper<`${Id}.${Name}`> {
    const id = contributionId(plugin.id, options.name, "状态栏条目");
    const {name: _name, title, alignment, order, priority, command, ...rest} = options;
    const declaration: ItemDeclaration = {
        ...rest,
        title: localizedText(title),
        alignment: alignment ?? "right",
        order: order ?? 0,
        priority: priority ?? 0,
        ...(command === undefined ? {} : {command: "contribution" in command ? {id: command.id} : command}),
    };
    return {
        id,
        contribution: {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id, declaration},
        where: "browser",
        activationEvents: [],
        implement: (implementation) => bound(WORKBENCH_STATUSBAR_ITEMS_POINT, id, implementation),
    };
}

export interface ChoicesHelper<Id extends string> extends ContributionHelper<typeof SETTINGS_CHOICES_POINT, Id> {
    readonly where: "browser";
    /** 给设置项的下拉列表供选项；设置项的 `choices` 写 `{from: 这个助手.id}`。 */
    implement(source: () => MaybeRefOrGetter<OptionSource<string>>): BoundImplementation<typeof SETTINGS_CHOICES_POINT, Id>;
}

/** 选项来源：设置窗口要它的选项时才激活入口，激活事件由 `plugin.entry` 自动并入。 */
export function choices<const Id extends string, const Name extends string>(plugin: PluginBuilder<Id>, options: {readonly name: Name}): ChoicesHelper<`${Id}.${Name}`> {
    const id = contributionId(plugin.id, options.name, "选项来源");
    return {
        id,
        contribution: {capability: SETTINGS_CHOICES_POINT, id, declaration: {}},
        where: "browser",
        activationEvents: [settingsChoicesEvent(id)],
        implement: (source) => bound(SETTINGS_CHOICES_POINT, id, {source} satisfies SettingsChoicesImplementation),
    };
}
