<script setup lang="ts">
import type {SessionName} from "../host/format.js";
import TruncatedText from "./TruncatedText.vue";

/** “谁”这一类地方的会话名：标题（可截断）加短键（不截断）。契约见同名 .md。 */
withDefaults(defineProps<{session: SessionName; fullText?: boolean}>(), {fullText: true});
</script>

<template>
    <span class="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
        <template v-if="session.title">
            <!-- TruncatedText 的根是 Tooltip，不接 class：宽度上限写在外面这一层。这一层是 flex，TruncatedText 才是弹性子项，
                 父级的 line-through（失效的会话）能传进去；行内块里的文字不继承上层的文字装饰。 -->
            <span v-if="fullText" class="flex min-w-0 max-w-64"><TruncatedText :text="session.title" :copyable="false" /></span>
            <span v-else class="min-w-0 max-w-64 truncate">{{ session.title }}</span>
            <span class="nbdev-caption nbdev-secondary shrink-0 whitespace-nowrap font-normal">{{ session.short }}</span>
        </template>
        <span v-else class="whitespace-nowrap">{{ session.short }}</span>
    </span>
</template>
