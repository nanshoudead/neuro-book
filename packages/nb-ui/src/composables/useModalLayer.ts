/**
 * 同时打开的模态（`Dialog`、`AlertDialog`、`Drawer`）按打开顺序叠放：后打开的在上面。层级不能靠 DOM 顺序：各个模态的传送锚点
 * 在组件挂载时就定了，和打开顺序无关（从新建窗口里打开的目录选择器，节点可能排在新建窗口前面）。
 */

import {computed, onBeforeUnmount, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

import {NB_MODAL_MAX_LAYERS, NB_MODAL_Z_STEP, NB_Z_INDEX} from "../theme/z-index";

/** 全应用一份：已打开的模态，按打开顺序。 */
const openLayers = shallowRef<ReadonlyArray<symbol>>([]);

export function useModalLayer(open: () => boolean): {readonly zIndex: ComputedRef<number>} {
    const token = Symbol("modal-layer");
    const leave = (): void => {
        openLayers.value = openLayers.value.filter((layer) => layer !== token);
    };
    watch(open, (value) => {
        leave();
        if (value) openLayers.value = [...openLayers.value, token];
    }, {immediate: true});
    onBeforeUnmount(leave);
    const zIndex = computed(() => {
        const index = Math.max(0, openLayers.value.indexOf(token));
        return NB_Z_INDEX.dialog + Math.min(index, NB_MODAL_MAX_LAYERS - 1) * NB_MODAL_Z_STEP;
    });
    return {zIndex};
}
