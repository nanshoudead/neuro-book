/**
 * 页面浮层的贡献点 `workbench.overlays`（docs/specs/ui/workbench-shell.md 输出 41）：插件交一个组件，工作台在页面根上挂一份，
 * 首页与工作台页都挂。声明是纯数据，前后端都能引用；实现（`load()`）在 `web/contracts.ts`。工作台不认识贡献方，依赖方向是
 * “贡献方 → 工作台”。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

export const WORKBENCH_OVERLAYS_POINT = "workbench.overlays";

export const OverlayDeclarationSchema = Type.Object({
    /** 几个浮层的挂载顺序（同值按 id）；后挂的在文档里靠后。 */
    order: Type.Optional(Type.Integer({minimum: -1_000_000, maximum: 1_000_000})),
}, {additionalProperties: false});

export type OverlayDeclaration = Static<typeof OverlayDeclarationSchema>;

const OVERLAY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 只看这一条声明本身。id 的前缀由内核按贡献点的 `idPrefix` 核对（同视图），这里只看形状与声明。 */
export function validateOverlayContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_OVERLAYS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (id.length > 128 || !OVERLAY_ID.test(id)) return `浮层 id 必须是点分的小写段、至多 128 个字符：${id}`;
    if (!Value.Check(OverlayDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(OverlayDeclarationSchema, descriptor.declaration)][0];
        return `浮层 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}

/** `workbench.overlays` 贡献点：插件与测试都用这一份定义。 */
export const overlaysPoint: ContributionPointDefinition = {id: WORKBENCH_OVERLAYS_POINT, implementation: "required", idPrefix: "plugin", validate: validateOverlayContribution};
