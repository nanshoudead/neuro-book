import {hasInjectionContext, inject} from "vue";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../theme/z-index";

/**
 * 弹出层的层级：在 `Dialog`、`Drawer` 或浮动窗口里跟随它们注入的层级（`NB_POPOVER_Z_INDEX`），不在里面时回退到普通页面的
 * popover 层级。浮层的外观（边框、底色、模糊、阴影、内边距）由 `.nb-ui-popover-surface` 与 `.nb-ui-menu-surface`
 * 两个类给，不在这里。
 */
export function usePopoverLayer(): {zIndex: number} {
    return {zIndex: hasInjectionContext() ? inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover) : NB_Z_INDEX.popover};
}
