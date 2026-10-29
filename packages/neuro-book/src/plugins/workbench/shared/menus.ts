/**
 * 工作台拥有的菜单位置（docs/specs/workbench/menus.md 的位置表）：标题栏应用菜单 `workbench.titlebar-menu` 与视图标题
 * `workbench.view-title`。菜单项的共同形状、校验与排序在命令插件的共享合同里，这里只加位置自己的字段。声明是纯数据，
 * 前后端都能引用。
 */

import {Type} from "typebox";

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {completeMenuItemDeclaration, MENU_BUTTON, menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import {workbenchText} from "./text";

export const WORKBENCH_TITLEBAR_MENU_POINT = "workbench.titlebar-menu";

/** 标题栏的四个组，按这个顺序画（docs/specs/ui/workbench-shell.md 外壳四输出 29）。组由工作台定，条目由各插件贡献。 */
export const TITLEBAR_MENU_GROUPS = [
    {id: "file", title: workbenchText("titlebar.groups.file")},
    {id: "edit", title: workbenchText("titlebar.groups.edit")},
    {id: "view", title: workbenchText("titlebar.groups.view")},
    {id: "help", title: workbenchText("titlebar.groups.help")},
] as const satisfies ReadonlyArray<{readonly id: string; readonly title: DisplayText}>;

export type TitlebarMenuGroup = (typeof TITLEBAR_MENU_GROUPS)[number]["id"];

export type TitlebarMenuItemDeclaration = MenuItemDeclaration & {readonly group: TitlebarMenuGroup};

export const titlebarMenuLocation = menuLocation(WORKBENCH_TITLEBAR_MENU_POINT, {group: Type.Union(TITLEBAR_MENU_GROUPS.map((group) => Type.Literal(group.id)))});

export const validateTitlebarMenuItem = menuItemValidator(titlebarMenuLocation);

/**
 * 别的插件给某个视图加的标题动作（docs/specs/workbench/views.md 输出 11）：`view` 是视图 id，可以是别的插件的视图；
 * `context: "instance"` 执行时收到被点的视图实例。
 */
export const WORKBENCH_VIEW_TITLE_POINT = "workbench.view-title";

export type ViewTitleItemDeclaration = MenuItemDeclaration & {readonly view: string};

export const viewTitleLocation = menuLocation(WORKBENCH_VIEW_TITLE_POINT, {view: Type.String({pattern: "\\S", maxLength: 128}), ...MENU_BUTTON}, {contexts: ["instance"], buttons: true});

export const validateViewTitleItem = menuItemValidator(viewTitleLocation);

/** 两个菜单贡献点：插件与测试都用这一份定义。菜单项只有声明，同活动栏条目交空实现：这样它随贡献方入口出现与消失（docs/specs/workbench/menus.md）。 */
export const titlebarMenuPoint: ContributionPointDefinition = {id: WORKBENCH_TITLEBAR_MENU_POINT, implementation: "required", idPrefix: "plugin", complete: completeMenuItemDeclaration, validate: validateTitlebarMenuItem};
export const viewTitlePoint: ContributionPointDefinition = {id: WORKBENCH_VIEW_TITLE_POINT, implementation: "required", idPrefix: "plugin", complete: completeMenuItemDeclaration, validate: validateViewTitleItem};
