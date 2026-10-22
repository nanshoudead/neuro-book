/**
 * 一行设置在某个标签下的样子（docs/specs/settings/settings-window.md 输出 10–13、18），由配置服务的 `inspect` 结果算出：
 * `SettingsRow` 据此画控件、沿用说明、已修改圆点、覆盖提示与停用。纯函数，不读配置服务。
 */

import type {LayerInspection, SettingDeclaration, SettingInspection, SettingLayer} from "nbook/shared/settings";

/** 一行标题后面的状态原因（输出 9）：色调按严重程度分，行只画一个图标，取最重的，提示逐条列出。 */
export type SettingsRowReason = {readonly tone: "error" | "warning" | "muted"; readonly text: string};

export type SettingsRowState =
    /** 这一层可以写：`value` 是控件显示的值（写了取这一层，没写取下一层），`written` 即“已修改”。 */
    | {readonly kind: "edit"; readonly value: unknown; readonly written: boolean; readonly blocked: boolean}
    /** 本作品标签、项目层没写：沿用下一层的值。 */
    | {readonly kind: "inherit"; readonly inherited: unknown; readonly blocked: boolean}
    /** 这一项的声明不允许这一层。 */
    | {readonly kind: "not-allowed"};

type Written = {readonly value: unknown} | null;

/** 这一层写了这个键：层无效时取上一份有效内容里的值（输出 13 的“显示上一份有效值”）。 */
function writtenIn(layer: LayerInspection<unknown>): Written {
    if ((layer.status === "ok" || layer.status === "invalid") && Object.hasOwn(layer, "value")) return {value: layer.value};
    return null;
}

/**
 * `layers` 是声明允许的层。`blocked`：这一层无效、不可达或本窗口没有它，控件停用（输出 13）；没写的项在用户层下面是
 * 默认值，在项目层下面是用户层的值（用户层不可达时是默认值）。
 */
export function settingsRowState(inspection: SettingInspection<unknown>, layers: ReadonlyArray<SettingLayer>, layer: SettingLayer): SettingsRowState {
    if (!layers.includes(layer)) return {kind: "not-allowed"};
    const here = inspection[layer];
    const blocked = here.status !== "ok";
    const written = writtenIn(here);
    const below = layer === "project" && layers.includes("user") ? writtenIn(inspection.user) : null;
    const lower = below === null ? inspection.default : below.value;
    if (written === null && layer === "project") return {kind: "inherit", inherited: lower, blocked};
    return {kind: "edit", value: written === null ? lower : written.value, written: written !== null, blocked};
}

/** 用户标签里，本作品层写了的项（输出 11）：给出本作品的值；没有覆盖为 null。 */
export function projectOverride(inspection: SettingInspection<unknown>, layers: ReadonlyArray<SettingLayer>, layer: SettingLayer): Written {
    if (layer !== "user" || !layers.includes("project")) return null;
    return writtenIn(inspection.project);
}

/** schema 写了 `readOnly`（输出 9）：界面不画控件，只写当前值。 */
export function isReadOnlySetting(declaration: SettingDeclaration): boolean {
    return "readOnly" in declaration.schema && declaration.schema.readOnly === true;
}
