<script setup lang="ts">
/**
 * 打开一本书：建会话（取回阅读状态、按地址合并）之后才挂上 BookFrame，页面数据都在这之后取（viewer“状态与转换”
 * 第 2 条）。书不在了就回书库并提示（F2）。地址里的书 id 变了就重建会话。
 */
import {onBeforeUnmount, shallowRef, watch} from "vue";
import {useRoute, useRouter} from "vue-router";

import {openBookSession, type BookSession} from "../host/book";
import {StoryCallError, useStoryClient} from "../host/client";
import BookFrame from "./BookFrame.vue";

const client = useStoryClient();
const route = useRoute();
const router = useRouter();
const session = shallowRef<BookSession | null>(null);
const error = shallowRef<string | null>(null);

const attempt = shallowRef(0);
// 打开一本书要等几次请求；等的时候又换了书，先开的那次回来时作废（销毁它，不盖掉后来的）。
let opening = 0;
watch([() => route.params.id, attempt], async ([id]) => {
    if (typeof id !== "string") return;
    if (session.value?.bookId === id) return;
    const token = ++opening;
    session.value?.dispose();
    session.value = null;
    error.value = null;
    try {
        const opened = await openBookSession(client, router, id);
        if (token !== opening) {
            opened.dispose();
            return;
        }
        session.value = opened;
    } catch (caught) {
        if (token !== opening) return;
        if (caught instanceof StoryCallError && caught.code === "book_not_found") {
            await router.replace({path: "/", query: {missing: id}});
            return;
        }
        if (caught instanceof StoryCallError) {
            error.value = caught.message;
            return;
        }
        throw caught;
    }
}, {immediate: true});

onBeforeUnmount(() => session.value?.dispose());
</script>

<template>
    <BookFrame v-if="session" :key="session.bookId" :session="session" />
    <div v-else-if="error" class="p-6 text-[var(--status-danger)]" role="alert">
        {{ error }} <button type="button" class="ml-2 underline" @click="attempt += 1">重试</button>
    </div>
    <div v-else class="p-6 text-[var(--text-muted)]">正在打开……</div>
</template>
