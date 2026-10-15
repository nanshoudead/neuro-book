<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {TITLE_SOURCE, type SessionName} from "../host/format.js";
import SessionLabel from "./SessionLabel.vue";

/** 一份租约（谁在动）的虚线胶囊；契约见同名 .md。 */
const props = withDefaults(defineProps<{session: SessionName; task?: string | null; stale?: boolean; ended?: boolean; hint?: string; compact?: boolean}>(), {task: null, stale: false, ended: false, hint: "", compact: false});
/** 提示：调用方的说明在前，有标题时补上完整标题与它从哪里读的（标题可能被截断，`compact` 时根本不显示）。 */
const tip = computed(() => {
    const {title, source} = props.session;
    const titleNote = title && source ? `${title}（标题取自 ${TITLE_SOURCE[source]}）` : "";
    return [props.hint, titleNote].filter((part) => part !== "").join("；");
});
</script>

<template>
    <Tooltip :text="tip" :disabled="tip === ''">
        <span
            class="nbdev-note inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-[var(--status-info,var(--accent-main))] px-2 py-0.5"
            :class="{'opacity-55': stale && !ended, 'line-through': ended}"
            :tabindex="tip === '' ? undefined : 0"
        >
            <span class="i-lucide-user-round size-3 shrink-0" aria-hidden="true" />
            <span v-if="compact" class="whitespace-nowrap">{{ session.short }}</span>
            <!-- 完整标题在胶囊自己的提示里，标题这里只截断，不再套一层提示。 -->
            <SessionLabel v-else :session="session" :full-text="false" />
            <span v-if="task" class="shrink-0 nbdev-secondary">· {{ task }}</span>
            <span v-if="ended" class="sr-only">（已失效）</span>
        </span>
    </Tooltip>
</template>
