/**
 * 状态栏与标题栏的条目贡献点（docs/specs/ui/workbench-shell.md 外壳四输出 33）与活动栏底部条目贡献点（输出 40）：声明与
 * 登记校验。声明是纯数据，前后端都能引用；实现（`text()` 等）在 `web/contracts.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

export const WORKBENCH_STATUSBAR_ITEMS_POINT = "workbench.statusbar-items";
export const WORKBENCH_TITLEBAR_ITEMS_POINT = "workbench.titlebar-items";

export type WorkbenchItemsPoint = typeof WORKBENCH_STATUSBAR_ITEMS_POINT | typeof WORKBENCH_TITLEBAR_ITEMS_POINT;

/** 活动栏底部的全局项（账号、设置这类），纯声明。 */
export const WORKBENCH_ACTIVITYBAR_ITEMS_POINT = "workbench.activitybar-items";

const Rank = Type.Integer({minimum: -1_000_000, maximum: 1_000_000});
const CommandReference = Type.Object({id: Type.String({pattern: "\\S"}), args: Type.Optional(Type.Record(Type.String(), Type.Unknown()))}, {additionalProperties: false});
const When = Type.Object({requires: Type.Array(Type.String({pattern: "\\S"}))}, {additionalProperties: false});

export const ItemDeclarationSchema = Type.Object({
    /** 条目的名字：“更多”菜单与读屏用它。 */
    title: TextSchema,
    alignment: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    /** 同侧从小到大排。 */
    order: Rank,
    /** 放不下时先收起小的。 */
    priority: Rank,
    command: Type.Optional(CommandReference),
    when: Type.Optional(When),
}, {additionalProperties: false});

export type ItemDeclaration = Static<typeof ItemDeclarationSchema>;

export const ActivityBarItemDeclarationSchema = Type.Object({
    /** 悬停提示与可访问名称；没有命令的条目以它说明为什么不可点。 */
    title: TextSchema,
    icon: Type.String({pattern: "\\S"}),
    /** 从上往下按它排，同值按 id。 */
    order: Rank,
    /** 没有命令的条目不可点（占位）。 */
    command: Type.Optional(CommandReference),
    when: Type.Optional(When),
    /** 公开状态的布尔键：为真时按钮画成按下。 */
    toggled: Type.Optional(Type.String({pattern: "\\S"})),
}, {additionalProperties: false});

export type ActivityBarItemDeclaration = Static<typeof ActivityBarItemDeclarationSchema>;

const ITEM_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/**
 * 两个条目贡献点的登记校验：只看这一条声明本身。id 的前缀由内核按贡献点的 `idPrefix` 核对（同视图）；同 id 的两条由内核
 * 一起拒绝。标题栏的条目只放在右侧操作区。
 */
export function itemValidator(point: WorkbenchItemsPoint): (descriptor: ContributionDescriptor) => string | null {
    return (descriptor) => {
        if (descriptor.location !== "browser") return `${point} 只接受浏览器入口的贡献`;
        const id = descriptor.id;
        if (id.length > 128 || !ITEM_ID.test(id)) return `条目 id 必须是点分的小写段、至多 128 个字符：${id}`;
        if (!Value.Check(ItemDeclarationSchema, descriptor.declaration)) {
            const first = [...Value.Errors(ItemDeclarationSchema, descriptor.declaration)][0];
            return `条目 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
        }
        if (point === WORKBENCH_TITLEBAR_ITEMS_POINT && (descriptor.declaration as ItemDeclaration).alignment !== "right") return `标题栏的条目只放在右侧：${id}`;
        return null;
    };
}

/**
 * `workbench.activitybar-items` 的登记校验：id 规则与上面两个条目贡献点相同。只有声明、没有要实现的东西，仍写在浏览器入口下：
 * 条目随贡献方入口出现与消失，入口没激活时它执行的命令多半也还不在。
 */
export function validateActivityBarItemContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_ACTIVITYBAR_ITEMS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (id.length > 128 || !ITEM_ID.test(id)) return `条目 id 必须是点分的小写段、至多 128 个字符：${id}`;
    if (!Value.Check(ActivityBarItemDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(ActivityBarItemDeclarationSchema, descriptor.declaration)][0];
        return `条目 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}

/**
 * 三个条目贡献点：插件与测试都用这一份定义。条目只有声明，内核却只能对整个贡献点规定要不要实现：要实现，贡献方交空对象。
 * 没写 `title` 时补约定键 `statusItems`、`titlebarItems`、`activityItems` 加 `.<本地 id>.title`（ui/workbench-shell.md 输出 33、40）。
 */
export const statusbarItemsPoint: ContributionPointDefinition = {id: WORKBENCH_STATUSBAR_ITEMS_POINT, implementation: "required", idPrefix: "plugin", complete: conventionCompleter({name: "statusItems", fields: ["title"]}), validate: itemValidator(WORKBENCH_STATUSBAR_ITEMS_POINT)};
export const titlebarItemsPoint: ContributionPointDefinition = {id: WORKBENCH_TITLEBAR_ITEMS_POINT, implementation: "required", idPrefix: "plugin", complete: conventionCompleter({name: "titlebarItems", fields: ["title"]}), validate: itemValidator(WORKBENCH_TITLEBAR_ITEMS_POINT)};
export const activityBarItemsPoint: ContributionPointDefinition = {id: WORKBENCH_ACTIVITYBAR_ITEMS_POINT, implementation: "required", idPrefix: "plugin", complete: conventionCompleter({name: "activityItems", fields: ["title"]}), validate: validateActivityBarItemContribution};
