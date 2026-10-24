<script setup lang="ts">
/**
 * 专注计时的侧栏视图。状态全在 store 里（`focus-store.ts`），组件只负责画与按键。
 *
 * - 一个主按钮原位换文字与动作：用键盘按“开始”之后焦点还在这个按钮上，接着按一次就是“放弃”。换成两个按钮按状态显示时，
 *   被按的那个从页面上消失，焦点掉到页面最外层，键盘用户要从头 Tab 一遍。代价：本机往返只要几十毫秒，双击“开始专注”
 *   会开始并立刻放弃。示例接受这一点；放弃代价大的功能，给放弃加确认或在开始后的短时间内不响应第二下。
 * - 剩余时间用 `role="timer"`：读屏不会每秒念一遍。空闲时没有计时，只画给眼睛看的 `--:--`，读屏跳过它。
 * - 完成、放弃在礼貌型的播报区域里念一次。每次结束都换一个新的文字节点（`:key`）：只改文字时，连着两次“已放弃”文字
 *   相同，DOM 不变，读屏不会再念。
 * - 外壳已经给 `layout: "scroll"` 的视图加了内边距，组件根上不再加。样式只用 SDK 的组件与主题变量，按窄侧栏写：按钮
 *   放不下时换行。
 */

import type {ViewContext} from "@notnotype/nb-plugin-sdk/workbench";
import {Button} from "@notnotype/nb-plugin-sdk/components";

import {formatRemaining} from "./focus-store";
import type {FocusStore} from "./focus-store";

const props = defineProps<{
    context: ViewContext;
    store: FocusStore;
}>();

</script>

<template>
    <div class="focus-panel" data-focus-panel>
        <p v-if="!props.store.view.value.ready && props.store.view.value.problem === null" class="focus-panel__hint">正在读取…</p>
        <template v-else-if="props.store.view.value.ready">
            <p v-if="props.store.view.value.running" class="focus-panel__clock" role="timer" aria-label="剩余时间" data-focus-remaining>
                {{ formatRemaining(props.store.view.value.remainingMs) }}
            </p>
            <p v-else class="focus-panel__clock" aria-hidden="true" data-focus-remaining>--:--</p>
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
        <!-- 同步断了：数据可能是旧的，给一个重新订阅的入口。 -->
        <div v-if="!props.store.view.value.synced && props.store.view.value.problem !== null" class="focus-panel__actions">
            <Button variant="secondary" data-focus-resync @click="props.store.connect()">重新同步</Button>
        </div>
        <p class="focus-panel__live" aria-live="polite" data-focus-announcement>
            <span v-if="props.store.view.value.ended !== null" :key="props.store.view.value.ended.seq">
                {{ props.store.view.value.ended.kind === "completed" ? "完成了一次专注" : "已放弃这次专注" }}
            </span>
        </p>
    </div>
</template>

<style scoped>
.focus-panel {
    display: flex;
    flex-direction: column;
    position: relative;
    gap: var(--space-3);
}

.focus-panel__clock {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xl);
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
