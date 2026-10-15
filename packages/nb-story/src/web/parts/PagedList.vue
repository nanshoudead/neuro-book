<script setup lang="ts" generic="T">
/**
 * 按需分页的长列表：列出已取到的条目，滚到末尾附近时发 more 取下一页（viewer 输出 18）。
 */
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

const props = defineProps<{items: readonly T[]; total: number | null; loading: boolean; hasMore: boolean; error: string | null; emptyText?: string}>();
const emit = defineEmits<{more: []; retry: []}>();
defineSlots<{item(props: {item: T; index: number}): unknown}>();

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
    observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && props.hasMore && !props.loading) emit("more");
    }, {rootMargin: "400px 0px"});
    if (sentinel.value) observer.observe(sentinel.value);
});
// 一页没填满视口时哨兵一直在可见区里，IntersectionObserver 不会再报；取完一页后再看一次。
watch(() => [props.items.length, props.loading] as const, ([, loading]) => {
    if (loading || !props.hasMore || !sentinel.value) return;
    const box = sentinel.value.getBoundingClientRect();
    if (box.top < window.innerHeight + 400) emit("more");
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <div class="paged-list">
        <template v-for="(item, index) in props.items" :key="index"><slot name="item" :item="item" :index="index" /></template>
        <p v-if="props.error" class="py-3 text-[var(--text-sm)] text-[var(--status-danger)]">
            {{ props.error }}
            <button type="button" class="ml-2 underline" @click="emit('retry')">重试</button>
        </p>
        <p v-else-if="props.loading" class="py-3 text-[var(--text-sm)] text-[var(--text-muted)]">正在取……</p>
        <p v-else-if="props.total === 0" class="py-3 text-[var(--text-sm)] text-[var(--text-muted)]">{{ props.emptyText ?? "没有记录" }}</p>
        <div ref="sentinel" class="h-px" aria-hidden="true" />
    </div>
</template>
