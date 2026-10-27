<script setup lang="ts">
// 文字回复下面的“没核实的出处”（w00024 t13 决定 8；附注 `nb-story.unverified-refs`，见 turns.ts）：提醒色一行，出处可点
// 打开原文抽屉。说明见同名 .md。
import {computed} from "vue";
import type {EntryComponentProps, HostComponentEmits} from "@notnotype/nb-agent-ui";

import {refTarget} from "./link-refs";

const props = defineProps<EntryComponentProps>();
const emit = defineEmits<HostComponentEmits>();

const refs = computed(() => {
    const value = (props.annotation.details as {refs?: unknown} | undefined)?.refs;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
});
</script>

<template>
    <div class="unverified" data-qa-unverified>
        <span class="i-lucide-triangle-alert shrink-0" aria-hidden="true" />
        <template v-if="refs.length === 0">
            <span>这一轮没有查原文，回答没有出处</span>
        </template>
        <template v-else>
            <span>没核实的出处：</span>
            <button v-for="refText in refs" :key="refText" type="button" class="unverified-ref" @click="emit('action', {type: 'reference.open', target: refTarget(refText)})">{{ refText }}</button>
            <span class="unverified-note">这一轮没读过这些段，或它们在阅读位置之后，内容可能不准</span>
        </template>
    </div>
</template>

<style scoped>
.unverified {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-control);
    background: var(--status-warning-bg);
    padding: 4px 8px;
    font-size: var(--text-xs);
    color: var(--status-warning);
}
.unverified-ref { border-radius: var(--radius-control); padding: 0 3px; color: inherit; text-decoration: underline dotted; }
.unverified-ref:hover { background: var(--bg-hover); }
.unverified-note { color: var(--text-muted); }
</style>
