<script setup lang="ts">
/** 窗口已就绪，但页面表里没有这个路径（包括生产构建里的开发页面，例如 `/lab`）。 */
import {RouterLink, useRoute} from "vue-router";

import {useText} from "@notnotype/nb-ui/text-port";

import {hostText} from "./host-text";

const route = useRoute();
const {t} = useText();
</script>

<template>
    <main class="nb-host-page" data-page-not-found data-page-rendered>
        <h1>{{ t(hostText('notFound.title')) }}</h1>
        <p class="nb-host-reason">{{ route.fullPath }}</p>
        <RouterLink to="/">{{ t(hostText('notFound.home')) }}</RouterLink>
    </main>
</template>
