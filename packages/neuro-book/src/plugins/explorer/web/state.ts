/**
 * 资源管理器的公开状态（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：命令 `when` 要读的
 * 布尔键与“显示清单文件”标题动作的按下态，不公开选择本身。`when` 只说明有没有可作用的选择，执行时再按选择核对。
 */

import {computed} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";

import {explorerText} from "../shared/text";
import type {Availability, ExplorerController} from "./controller";

export const explorerState = definePublicState("nbook.explorer", {
    ready: {type: "boolean", unready: false, reason: explorerText("state.ready.reason")},
    canCreate: {type: "boolean", unready: false, reason: explorerText("state.canCreate.reason")},
    hasSelection: {type: "boolean", unready: false, reason: explorerText("state.hasSelection.reason")},
    canPaste: {type: "boolean", unready: false, reason: explorerText("state.canPaste.reason")},
    canReorder: {type: "boolean", unready: false, reason: explorerText("state.canReorder.reason")},
    canCreateContent: {type: "boolean", unready: false, reason: explorerText("state.canCreateContent.reason")},
    canConvert: {type: "boolean", unready: false, reason: explorerText("state.canConvert.reason")},
    canEditManifest: {type: "boolean", unready: false, reason: explorerText("state.canEditManifest.reason")},
    showManifests: {type: "boolean", unready: false, reason: explorerText("state.showManifests.reason")},
});

/** 各公开键此刻的值：由控制器的选择与可用性算出；没有控制器时都为假。产品入口与 Lab 场景共用。 */
export function explorerStateValues(controller: Readonly<ShallowRef<ExplorerController | null>>): Record<keyof typeof explorerState.declarations, ComputedRef<boolean>> {
    const available = (pick: (available: Availability) => boolean) => computed(() => controller.value !== null && pick(controller.value.available.value));
    return {
        ready: computed(() => controller.value !== null),
        canCreate: available((can) => can.create),
        hasSelection: computed(() => (controller.value?.selection.value.selected.length ?? 0) > 0),
        canPaste: available((can) => can.paste),
        canReorder: available((can) => can.moveUp || can.moveDown),
        canCreateContent: available((can) => can.createContent),
        canConvert: available((can) => can.convert),
        canEditManifest: available((can) => can.display || can.include || can.drop),
        showManifests: computed(() => controller.value?.showManifests.value === true),
    };
}
