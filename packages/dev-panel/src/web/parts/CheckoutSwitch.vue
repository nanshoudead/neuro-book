<script setup lang="ts">
import {Badge, Select} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import type {CheckoutRef} from "../host/types.js";

const props = withDefaults(defineProps<{checkouts: CheckoutRef[]; modelValue: string; preferred?: string[]}>(), {preferred: () => []});
const emit = defineEmits<{"update:modelValue": [key: string]}>();

const options = computed(() => {
    const rank = (checkout: CheckoutRef) => (props.preferred.includes(checkout.key) ? props.preferred.indexOf(checkout.key) : checkout.isMain ? 100 : 200);
    return [...props.checkouts].sort((left, right) => rank(left) - rank(right) || left.key.localeCompare(right.key)).map((checkout) => ({
        value: checkout.key,
        label: checkout.isMain ? "主工作区（master）" : checkout.key,
        description: [checkout.branch ?? "分离 HEAD", props.preferred.includes(checkout.key) ? "这个 Task" : ""].filter(Boolean).join(" · "),
    }));
});
const current = computed(() => props.checkouts.find((checkout) => checkout.key === props.modelValue) ?? null);
</script>

<template>
    <div class="flex min-w-0 flex-wrap items-center gap-2">
        <div class="min-w-48 flex-1"><Select :model-value="modelValue" :options="options" aria-label="看哪个 checkout 的文档" @update:model-value="(value: string) => emit('update:modelValue', value)" /></div>
        <Badge v-if="current && !current.isMain" tone="warning" variant="soft" size="sm" icon-class="i-lucide-git-branch">不是 master：{{ current.branch ?? current.key }}</Badge>
    </div>
</template>
