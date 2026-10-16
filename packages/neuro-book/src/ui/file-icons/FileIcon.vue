<script setup lang="ts">
import {computed} from "vue";

import {CATPPUCCIN_ICONS} from "./catppuccin";
import type {CatppuccinIcon} from "./catppuccin";

const props = defineProps<{icon: CatppuccinIcon}>();

const body = computed(() => CATPPUCCIN_ICONS[props.icon]);
</script>

<template>
    <!-- 图标表是生成脚本从固定的图标包里挑出的 SVG 片段，不含用户输入，v-html 安全。 -->
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true" data-file-icon :data-icon="icon" v-html="body"></svg>
</template>

<style>
/* catppuccin 的 Latte（亮）与 Macchiato（暗），按色名一一对应：https://catppuccin.com/palette */
:root {
    --file-icon-text: #4c4f69;
    --file-icon-blue: #1e66f5;
    --file-icon-yellow: #df8e1d;
    --file-icon-green: #40a02b;
    --file-icon-overlay1: #8c8fa1;
    --file-icon-peach: #fe640b;
    --file-icon-red: #d20f39;
    --file-icon-mauve: #8839ef;
    --file-icon-sky: #04a5e5;
    --file-icon-sapphire: #209fb5;
    --file-icon-pink: #ea76cb;
    --file-icon-teal: #179299;
    --file-icon-maroon: #e64553;
    --file-icon-lavender: #7287fd;
    --file-icon-rosewater: #dc8a78;
    --file-icon-flamingo: #dd7878;
}

:root[data-nb-appearance="dark"] {
    --file-icon-text: #cad3f5;
    --file-icon-blue: #8aadf4;
    --file-icon-yellow: #eed49f;
    --file-icon-green: #a6da95;
    --file-icon-overlay1: #8087a2;
    --file-icon-peach: #f5a97f;
    --file-icon-red: #ed8796;
    --file-icon-mauve: #c6a0f6;
    --file-icon-sky: #91d7e3;
    --file-icon-sapphire: #7dc4e4;
    --file-icon-pink: #f5bde6;
    --file-icon-teal: #8bd5ca;
    --file-icon-maroon: #ee99a0;
    --file-icon-lavender: #b7bdf8;
    --file-icon-rosewater: #f4dbd6;
    --file-icon-flamingo: #f0c6c6;
}
</style>
