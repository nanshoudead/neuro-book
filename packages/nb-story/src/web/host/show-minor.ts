/**
 * 人物卡“关于他的”展开次要说法与否（viewer 输出 56）：抽屉与主区的记录表共用一份，切一处另一处跟着变，并记进浏览器偏好。
 */

import {computed, ref, type Ref, type WritableComputedRef} from "vue";

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
