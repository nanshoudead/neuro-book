<script setup lang="ts">
import {Button, IconButton} from "@notnotype/nb-ui/components";

defineProps<{label: string; openLabel: string}>();
const emit = defineEmits<{(event: "open"): void; (event: "clear"): void}>();
</script>

<template>
    <div
        class="graph-selection-bar pointer-events-auto absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-surface)] px-3 py-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] shadow-[var(--shadow-panel)]"
        data-testid="graph-selection-bar" role="status"
    >
        <span class="min-w-0 truncate">已选中 <b class="text-[var(--text-main)]">{{ label }}</b></span>
        <Button size="sm" variant="secondary" @click="emit('open')">{{ openLabel }}</Button>
        <span class="hidden whitespace-nowrap sm:inline">双击或按 Enter 也能打开 · 按 F 只看周边</span>
        <IconButton size="xs" icon-class="i-lucide-x" aria-label="取消选中" title="取消选中" @click="emit('clear')" />
    </div>
</template>
