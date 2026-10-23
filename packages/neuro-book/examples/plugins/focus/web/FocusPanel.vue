<script setup lang="ts">
/**
 * 专注计时的侧栏视图。状态全在 store 里（`focus-store.ts`），组件只负责画与按键。
 *
 * - 一个主按钮原位换文字与动作：用键盘按“开始”之后焦点还在这个按钮上，接着按一次就是“放弃”。换成两个按钮按状态显示时，
 *   被按的那个从页面上消失，焦点掉到页面最外层，键盘用户要从头 Tab 一遍。
 * - 剩余时间用 `role="timer"`：读屏不会每秒念一遍。完成、放弃各用一个礼貌型的播报区域念一次。
 * - 样式只用 SDK 的组件与主题变量，按窄侧栏写：按钮放不下时换行。
 */
import {ref, watch} from "vue";

import type {ViewContext} from "@notnotype/nb-plugin-sdk/browser";
import {Button} from "@notnotype/nb-plugin-sdk/components";

import {formatRemaining} from "./focus-store";
import type {FocusStore} from "./focus-store";

const props = defineProps<{
    context: ViewContext;
    store: FocusStore;
}>();

const announcement = ref("");

watch(() => props.store.view.value, (next, previous) => {
    if (!previous.running || next.running) return;
    announcement.value = next.completed > previous.completed ? "完成了一次专注" : "已放弃这次专注";
});
</script>

<template>
    <div class="focus-panel" data-focus-panel>
        <p v-if="!props.store.view.value.ready" class="focus-panel__hint">正在读取…</p>
        <template v-else>
            <p class="focus-panel__clock" role="timer" aria-label="剩余时间" data-focus-remaining>
                {{ props.store.view.value.running ? formatRemaining(props.store.view.value.remainingMs) : "--:--" }}
            </p>
            <div class="focus-panel__actions">
                <Button :variant="props.store.view.value.running ? 'secondary' : 'primary'" data-focus-toggle @click="props.store.toggle()">
                    {{ props.store.view.value.running ? "放弃" : "开始专注" }}
                </Button>
            </div>
            <p class="focus-panel__today" data-focus-today>
                今天完成 {{ props.store.view.value.completed }} 次，共 {{ props.store.view.value.minutes }} 分钟
            </p>
        </template>
        <p v-if="props.store.view.value.problem !== null" class="focus-panel__problem" role="alert">{{ props.store.view.value.problem }}</p>
        <p class="focus-panel__live" aria-live="polite" data-focus-announcement>{{ announcement }}</p>
    </div>
</template>

<style scoped>
.focus-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
}

.focus-panel__clock {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 28px;
    color: var(--text-main);
}

.focus-panel__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.focus-panel__hint,
.focus-panel__today {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.focus-panel__problem {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--status-danger);
}

/* 只给读屏：看得见的变化已经在上面画了。 */
.focus-panel__live {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
