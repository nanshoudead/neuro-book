/**
 * 工作台的公开状态（docs/specs/ui/workbench-shell.md 外壳一输出 13，`focusedPart` 见外壳二输出 27）：面板命令的 `when` 读其中的布尔键，字符串键只供
 * 读取。布局 store 还没创建、记录没读完或呈现事实还没到时，依赖它们的布尔键为 false。
 *
 * “水平位置”按保存的位置判断：紧凑呈现把左右面板临时放到底部，但那时收起对它不生效（几何按保存的位置决定能否收起），
 * 所以收起与对齐命令在左右位置的面板上始终不可用。
 */

import {computed} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";
import type {PublicBindings} from "nbook/shared/store/public";

import {workbenchText} from "../../shared/text";
import {isHorizontalPanelPosition, panelMaximizable} from "../shell/panel-state";
import type {LayoutStore} from "./layout-store";

export const workbenchState = definePublicState("nbook.workbench", {
    layoutReady: {type: "boolean", unready: false, reason: workbenchText("state.layoutReady.reason")},
    nonCompact: {type: "boolean", unready: false, reason: workbenchText("state.nonCompact.reason")},
    panelHorizontal: {type: "boolean", unready: false, reason: workbenchText("state.panelHorizontal.reason")},
    panelMaximizable: {type: "boolean", unready: false, reason: workbenchText("state.panelMaximizable.reason")},
    panelVisible: {type: "boolean", unready: false, reason: workbenchText("state.panelVisible.reason")},
    sidebarVisible: {type: "boolean", unready: false, reason: workbenchText("state.sidebarVisible.reason")},
    auxiliaryBarVisible: {type: "boolean", unready: false, reason: workbenchText("state.auxiliaryBarVisible.reason")},
    activityBarVisible: {type: "boolean", unready: false, reason: workbenchText("state.activityBarVisible.reason")},
    panelMaximized: {type: "boolean", unready: false, reason: workbenchText("state.panelMaximized.reason")},
    panelPosition: {type: "string", unready: "bottom"},
    panelAlignment: {type: "string", unready: "center"},
    focusedPart: {type: "string", unready: "editor"},
});

export function workbenchStateBindings(layout: Readonly<ShallowRef<LayoutStore | null>>): PublicBindings<typeof workbenchState.declarations> {
    /** store 已创建、记录读完、呈现事实已到：几何相关的判断才有依据。 */
    const settled = computed(() => {
        const store = layout.value;
        return store !== null && store.state.ready && store.state.facts !== null ? store : null;
    });
    const panel = computed(() => layout.value?.state.panel ?? null);
    return {
        layoutReady: computed(() => layout.value?.state.ready ?? false),
        nonCompact: computed(() => settled.value?.state.facts?.mode === "split"),
        panelHorizontal: computed(() => settled.value !== null && isHorizontalPanelPosition(settled.value.state.panel.position)),
        panelMaximizable: computed(() => {
            const store = settled.value;
            if (store === null || store.state.facts?.mode !== "split") return false;
            const {position, alignment, hidden} = store.state.panel;
            return !hidden && panelMaximizable(position, alignment);
        }),
        panelVisible: computed(() => layout.value !== null && !layout.value.state.panel.hidden && layout.value.state.dragCollapsed.panel !== true),
        sidebarVisible: computed(() => layout.value?.actions.partVisible("sidebar") ?? false),
        auxiliaryBarVisible: computed(() => layout.value?.actions.partVisible("auxiliarybar") ?? false),
        activityBarVisible: computed(() => layout.value?.actions.partVisible("activitybar") ?? false),
        panelMaximized: computed(() => panel.value?.maximized ?? false),
        panelPosition: computed(() => panel.value?.position ?? "bottom"),
        panelAlignment: computed(() => panel.value?.alignment ?? "center"),
        focusedPart: computed(() => layout.value?.state.focusedPart ?? "editor"),
    };
}
