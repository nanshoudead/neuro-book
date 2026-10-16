<script setup lang="ts">
import {computed} from "vue";

import {CATPPUCCIN_ICONS} from "./catppuccin";
import "./palette.css";
import type {CatppuccinIcon} from "./catppuccin";

const props = defineProps<{icon: CatppuccinIcon}>();

const body = computed(() => CATPPUCCIN_ICONS[props.icon]);
</script>

<template>
    <!-- 图标表是生成脚本从固定的图标包里挑出的 SVG 片段，不含用户输入，v-html 安全。 -->
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true" data-file-icon :data-icon="icon" v-html="body"></svg>
</template>
