<script setup lang="ts">
const props = defineProps<{
    canUseSelectedMutation: boolean;
}>();

const emit = defineEmits<{
    (e: "add-mutation", mode: "append" | "replace"): void;
    (e: "insert-after-selected-mutation"): void;
    (e: "duplicate-selected-mutation"): void;
    (e: "replace-selected-mutation"): void;
    (e: "delete-selected-mutation"): void;
}>();
</script>

<template>
    <!-- Mutation 列表写入动作 -->
    <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="emit('add-mutation', 'append')">
            <span class="i-lucide-list-plus h-3.5 w-3.5"></span>
            追加
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!canUseSelectedMutation" title="用 Builder 当前内容替换所选 mutation" @click="emit('replace-selected-mutation')">
            <span class="i-lucide-square-pen h-3.5 w-3.5"></span>
            替换所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!canUseSelectedMutation" title="在所选 mutation 后插入 Builder 当前内容" @click="emit('insert-after-selected-mutation')">
            <span class="i-lucide-corner-down-right h-3.5 w-3.5"></span>
            插入其后
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!canUseSelectedMutation" title="复制所选 mutation 到下一位" @click="emit('duplicate-selected-mutation')">
            <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
            复制所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-red-500/30 px-2 text-[12px] text-red-600 hover:bg-red-500/10 disabled:opacity-50" :disabled="!canUseSelectedMutation" title="删除所选 mutation" @click="emit('delete-selected-mutation')">
            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
            删除所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="emit('add-mutation', 'replace')">
            <span class="i-lucide-refresh-ccw h-3.5 w-3.5"></span>
            替换全部
        </button>
    </div>
</template>
