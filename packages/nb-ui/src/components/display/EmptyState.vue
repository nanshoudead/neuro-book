<script setup lang="ts">
// 空状态占位：列表/查询无数据时的居中提示，action 插槽放主操作按钮；icon 插槽换掉圆底里的图标（例如加载中放 Spinner）。
const props = withDefaults(defineProps<{
    iconClass?: string;
    title?: string;
    description?: string;
}>(), {
    iconClass: "i-lucide-inbox",
    title: "暂无数据",
    description: "",
});
</script>

<template>
    <div class="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">
            <slot name="icon"><span :class="props.iconClass" class="h-5 w-5"></span></slot>
        </span>
        <div class="max-w-sm">
            <p class="text-sm font-medium text-[var(--text-main)]">{{ props.title }}</p>
            <p v-if="props.description || $slots.default" class="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                <slot>{{ props.description }}</slot>
            </p>
        </div>
        <div v-if="$slots.action" class="mt-1">
            <slot name="action" />
        </div>
    </div>
</template>
