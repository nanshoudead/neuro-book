<script setup lang="ts">
/**
 * 列表顶部“展开次要（N）”与“收起次要（N）”的切换（viewer 输出 9、56）。N 不知道时不写括号。
 */
const props = defineProps<{count: number | null; open: boolean}>();
const emit = defineEmits<{"update:open": [value: boolean]}>();
</script>

<template>
    <button type="button" class="folded-bar" :aria-expanded="props.open" @click="emit('update:open', !props.open)">
        {{ props.open ? "收起次要" : "展开次要" }}{{ props.count !== null ? `（${props.count}）` : "" }}
    </button>
</template>

<style scoped>
.folded-bar {
    font-size: var(--text-sm);
    color: var(--accent-text);
}
.folded-bar:hover {
    text-decoration: underline;
}
</style>
