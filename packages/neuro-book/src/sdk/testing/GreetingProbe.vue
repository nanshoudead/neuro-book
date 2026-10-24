<script setup lang="ts">
/** 测试用的视图组件：一个必填属性、一个可选属性，外加宿主给的 `context`。`browser-plugin.dom.test.ts` 用它核对属性推导。 */
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

defineProps<{context: ViewContext; greeting: string; count?: number}>();
</script>

<template>
    <p class="greeting-probe">{{ greeting }}</p>
</template>
