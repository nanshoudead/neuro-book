<script setup lang="ts">
import {inject, onMounted} from "vue";

import type {ReactiveT} from "./reactive-t";

const props = defineProps<{ns: string; reactive: boolean; count?: number}>();
const reactiveT = inject<ReactiveT>("t")!;
const plainT = inject<(key: string, params?: Record<string, unknown>) => string>("plainT")!;
const emit = defineEmits<{mounted: []}>();
onMounted(() => emit("mounted"));
// 渲染期调用：模板里每次渲染都执行，所以能被响应式依赖追踪
const translate = (key: string, params?: Record<string, unknown>): string => props.reactive ? reactiveT(key, params) : plainT(key, params);
</script>

<template>
    <p data-title>{{ translate(`${ns}:title`) }}</p>
    <p data-files>{{ translate(`${ns}:files`, {count: count ?? 1}) }}</p>
</template>
