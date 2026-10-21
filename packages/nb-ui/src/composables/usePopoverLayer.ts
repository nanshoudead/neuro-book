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

/*
 * Select 与 ColorSwatches 的浮层另外内联了一份材质，与 `.nb-ui-popover-surface` 的取值对不上：阴影是写死的四层而不是
 * `--elevation-menu`，模糊是写死的 8px 而不是 `--overlay-blur`。以哪一边为准等开发者定（w00029 t05 的 F04、F05、F10），
 * 定了以后并回 CSS 类并删掉这两个常量。
 */

/** 四层投影（文字色细边加三层环境柔影）。 */
export const POPOVER_INLINE_BOX_SHADOW =
    "0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), " +
    "0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent), " +
    "0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent), " +
    "0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent)";

/** 8px 模糊、130% 饱和度。 */
export const POPOVER_INLINE_BACKDROP_FILTER = "blur(8px) saturate(130%) brightness(1.0)";

/** Select 与 ColorSwatches 绑在浮层上的内联材质与层级。 */
export function popoverInlineSurfaceStyle(zIndex: number): Record<string, string | number> {
    return {
        zIndex,
        backgroundColor: "var(--overlay-surface)",
        backdropFilter: POPOVER_INLINE_BACKDROP_FILTER,
        WebkitBackdropFilter: POPOVER_INLINE_BACKDROP_FILTER,
        boxShadow: POPOVER_INLINE_BOX_SHADOW,
    };
}
