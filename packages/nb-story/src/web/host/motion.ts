import {inject, ref, type InjectionKey, type Ref} from "vue";

/**
 * 分栏正在收起或展开（docs/specs/story/viewer.md 输出 1）：由书的外壳提供，过渡期间为 true。图的画布在这期间不换尺寸
 * （Sigma 换尺寸要整张重画，慢机器上一帧上百毫秒），变回 false 后换一次。不在外壳里用（例如单独测组件）时恒为 false。
 */
export const LAYOUT_MOTION: InjectionKey<Readonly<Ref<boolean>>> = Symbol("nb-story layout motion");

export function useLayoutMotion(): Readonly<Ref<boolean>> {
    return inject(LAYOUT_MOTION, ref(false));
}
