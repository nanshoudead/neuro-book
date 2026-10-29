/**
 * 人物卡“关于他的”展开次要说法与否（viewer 输出 56）：抽屉与主区的记录表共用一份，切一处另一处跟着变，并记进浏览器偏好。
 */

import {computed, ref, watch, type ComputedRef, type Ref, type WritableComputedRef} from "vue";

import {readShowMinorRecords, writeShowMinorRecords} from "./prefs";

let shown: Ref<boolean> | null = null;

export function useShowMinorRecords(): WritableComputedRef<boolean> {
    const state = (shown ??= ref(readShowMinorRecords()));
    return computed({
        get: () => state.value,
        set: value => {
            state.value = value;
            writeShowMinorRecords(value);
        },
    });
}

/**
 * 折叠条上的 N 与折叠条是否显示。切展开与收起会重取第一页，重取期间 `extra` 是 null；`tiers` 不随 `maxTier` 变
 * （queries 输出 23），所以沿用上一次的 N，免得折叠条在指针下消失、键盘焦点掉到页面上。`key` 写对象、搜索词与阅读位置：
 * 它们变了 N 也会变，重取期间不写数，折叠条按当前是否展开决定留不留。
 */
export function useMinorCount(
    extra: Ref<{tiers: [number, number, number]} | null>,
    key: () => string,
    showMinor: Ref<boolean>,
): {count: ComputedRef<number | null>; visible: ComputedRef<boolean>} {
    const last = ref<{key: string; count: number} | null>(null);
    watch(extra, value => {
        if (value) last.value = {key: key(), count: value.tiers[2]};
    }, {immediate: true});
    const count = computed(() => extra.value?.tiers[2] ?? (last.value?.key === key() ? last.value.count : null));
    return {count, visible: computed(() => (count.value === null ? showMinor.value : count.value > 0))};
}
