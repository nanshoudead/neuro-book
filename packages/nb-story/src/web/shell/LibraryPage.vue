<script setup lang="ts">
/**
 * 书架（docs/specs/story/viewer.md 输出 35）：列出书库里的书。登录后落到这里、书库里只有一本时直接打开它；从书里
 * 点“回到书架”过来（应用内导航，history.state.back 有值）时照常列出。地址里的书不在了时，书的外壳会带着
 * `missing` 回到这里（viewer F2）。
 */
import {onMounted, ref} from "vue";
import {useRoute, useRouter} from "vue-router";

import type {StoryResult} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";

const client = useStoryClient();
const route = useRoute();
const router = useRouter();
const books = ref<StoryResult<"books.list">["books"] | null>(null);
const error = ref<string | null>(null);
const missing = typeof route.query.missing === "string" ? route.query.missing : null;

onMounted(async () => {
    try {
        const result = await client.call("books.list", {});
        const fromApp = typeof (window.history.state as {back?: unknown} | null)?.back === "string";
        if (result.books.length === 1 && !missing && !fromApp) {
            await router.replace(`/book/${encodeURIComponent(result.books[0]!.id)}`);
            return;
        }
        books.value = result.books;
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        error.value = caught.message;
    }
});
</script>

<template>
    <main class="mx-auto flex h-full max-w-[720px] flex-col gap-4 p-6" data-testid="library">
        <h1 class="flex items-center gap-2 text-[length:var(--text-lg)] font-[var(--weight-strong)]"><span class="i-lucide-library text-[var(--accent-text)]" />书架</h1>
        <p v-if="missing" class="text-[var(--text-secondary)]" data-testid="book-missing">书“{{ missing }}”不在书库里了。</p>
        <p v-if="error" class="text-[var(--status-danger)]">{{ error }}</p>
        <p v-else-if="books && books.length === 0">书库里还没有书。用 <code>nbstory import &lt;文件&gt; --title &lt;书名&gt;</code> 导入。</p>
        <ul v-else-if="books" class="flex flex-col gap-1">
            <li v-for="book in books" :key="book.id">
                <RouterLink :to="`/book/${encodeURIComponent(book.id)}`" class="shelf-item flex items-baseline gap-3 rounded-[var(--radius-control)] px-3 py-2">
                    <span class="i-lucide-book self-center text-[var(--text-secondary)]" />
                    <b class="min-w-0 truncate">{{ book.title }}</b>
                    <span class="ml-auto shrink-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ book.chapters }} 章 · 抽取到 {{ book.extractedThrough.chapter }}.{{ book.extractedThrough.paragraph }}</span>
                </RouterLink>
            </li>
        </ul>
        <p v-if="books && books.length > 0" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">再导入一本：<code>nbstory import &lt;文件&gt; --title &lt;书名&gt;</code>。同时看几本书时各开一个浏览器标签。</p>
    </main>
</template>

<style scoped>
.shelf-item:hover {
    background: var(--bg-hover);
}
</style>
