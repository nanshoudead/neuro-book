<script setup lang="ts">
/**
 * 查看器的根：提供 HTTP 查询客户端；会话失效（401）时整页换成提示，不显示任何书的内容（viewer F1）。
 */
import {provide, ref} from "vue";

import {createHttpClient, STORY_CLIENT} from "./host/client";

const unauthorized = ref(false);
provide(STORY_CLIENT, createHttpClient(() => {
    unauthorized.value = true;
}));
</script>

<template>
    <div v-if="unauthorized" class="flex h-full items-center justify-center p-6 text-center" data-testid="unauthorized">
        <p>登录已失效，请用服务启动时打印的链接重新打开。</p>
    </div>
    <RouterView v-else />
</template>
