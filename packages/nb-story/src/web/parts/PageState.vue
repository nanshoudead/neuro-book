<script setup lang="ts">
/**
 * 一页的加载与出错状态：只这一页显示错误与“重试”，其它页与外壳照常（viewer F4）。
 */
defineProps<{loading: boolean; error: string | null}>();
const emit = defineEmits<{retry: []}>();
</script>

<template>
    <div v-if="error" class="flex items-center gap-2 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-testid="page-error">
        <span class="i-lucide-triangle-alert" />{{ error }}
        <button type="button" class="underline" @click="emit('retry')">重试</button>
    </div>
    <div v-else-if="loading" class="py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">正在取……</div>
</template>
