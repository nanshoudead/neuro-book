<script setup lang="ts">
/**
 * 视图组件：只用 SDK 的组件与主题变量写样式。不要写原子类（`p-4`、`flex` 这类）：宿主的原子类只按宿主自己的源码生成，
 * 插件里写了要么不生效、要么只是碰巧生效。
 */
import type {ViewContext} from "@notnotype/nb-plugin-sdk/browser";
import {Button} from "@notnotype/nb-plugin-sdk/components";

const props = defineProps<{
    context: ViewContext;
    greeting: string;
    count: number;
    sayHello: () => void;
}>();
</script>

<template>
    <div class="hello" data-hello-view>
        <p class="hello__greeting" data-hello-greeting>{{ props.greeting }}</p>
        <p class="hello__count" data-hello-count>已经打过 {{ props.count }} 次招呼</p>
        <Button variant="secondary" @click="props.sayHello()">打个招呼</Button>
    </div>
</template>

<style scoped>
.hello {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
}

.hello__greeting {
    margin: 0;
    color: var(--text-main);
}

.hello__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}
</style>
