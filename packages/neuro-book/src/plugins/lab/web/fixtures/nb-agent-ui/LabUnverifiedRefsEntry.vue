<script setup lang="ts">
/**
 * Lab 宿主登记的条目组件：nb-story 文字回复里“没核实的出处”的附注（docs/specs/story/qa.md 输出 24）。它是“宿主登记
 * 条目渲染器”的样例：从属性拿到这条附注与界面语言，点出处发 `reference.open`，由视图交给宿主。
 */
import {computed} from "vue";
import type {EntryComponentProps, HostComponentEmits} from "@notnotype/nb-agent-ui";

const props = defineProps<EntryComponentProps>();
const emit = defineEmits<HostComponentEmits>();

const refs = computed(() => {
    const details = props.annotation.details;
    const value = details !== null && typeof details === "object" && !Array.isArray(details) ? details.refs : undefined;
    return Array.isArray(value) ? value.filter((ref): ref is string => typeof ref === "string") : [];
});
const label = computed(() => (props.locale === "en-US" ? "Unverified sources" : "没核实的出处"));
const hint = computed(() => (props.locale === "en-US" ? "not read in this turn" : "这一轮没有读过这些段落"));
</script>

<template>
    <p class="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--status-warning-bg)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--status-warning)]" data-lab-unverified>
        <span class="i-lucide-triangle-alert" aria-hidden="true" />
        {{ label }}
        <button
            v-for="ref in refs"
            :key="ref"
            type="button"
            class="rounded-[var(--radius-control)] px-1 underline decoration-dotted hover:bg-[var(--bg-hover)]"
            data-unverified-ref
            @click="emit('action', {type: 'reference.open', target: `paragraph://${ref}`})"
        >{{ ref }}</button>
        <span class="text-[var(--text-muted)]">{{ hint }}</span>
    </p>
</template>
