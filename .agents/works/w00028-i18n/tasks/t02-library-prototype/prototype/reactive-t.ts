/**
 * 把 i18next 接到 Vue 的响应式：`t` 在读取时先读一个 `shallowRef` 版本号，渲染函数和 computed 因此依赖它；
 * 语言切换（`languageChanged`）与目录增删（store 的 `added`、`removed`）都让版本号加一，依赖它的渲染重新执行。
 * 选这种接法而不是“把当前语言放进 shallowRef”：目录热装卸时语言没变，也要刷新；一个版本号覆盖两种来源。
 */

import type {i18n} from "i18next";
import {onScopeDispose, getCurrentScope, shallowRef} from "vue";

export interface ReactiveT {
    (key: string, params?: Record<string, unknown>): string;
}

export function createReactiveT(instance: i18n): {readonly t: ReactiveT; readonly dispose: () => void} {
    const version = shallowRef(0);
    const bump = (): void => { version.value += 1; };
    instance.on("languageChanged", bump);
    instance.store.on("added", bump);
    instance.store.on("removed", bump);
    const dispose = (): void => {
        instance.off("languageChanged", bump);
        instance.store.off("added", bump);
        instance.store.off("removed", bump);
    };
    if (getCurrentScope()) onScopeDispose(dispose);
    const t: ReactiveT = (key, params) => {
        // 只为建立依赖；值本身不用
        void version.value;
        return instance.t(key, params as never) as string;
    };
    return {t, dispose};
}
