<script setup lang="ts">
/**
 * 书库：列出书，只有一本时直接打开它。地址里的书不在了时，书的外壳会带着 `missing` 回到这里（viewer F2）。
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
        if (result.books.length === 1 && !missing) {
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
    <main class="mx-auto flex h-full max-w-[720px] flex-col gap-4 p-6">
        <h1 class="text-[var(--text-lg)] font-[var(--weight-strong)]">剧情图谱</h1>
        <p v-if="missing" class="text-[var(--text-secondary)]" data-testid="book-missing">书“{{ missing }}”不在书库里了。</p>
        <p v-if="error" class="text-[var(--status-danger)]">{{ error }}</p>
        <p v-else-if="books && books.length === 0">书库里还没有书。用 <code>nbstory import &lt;文件&gt; --title &lt;书名&gt;</code> 导入。</p>
        <ul v-else-if="books" class="flex flex-col gap-2">
            <li v-for="book in books" :key="book.id">
                <RouterLink :to="`/book/${encodeURIComponent(book.id)}`" class="flex items-baseline gap-2 rounded-[var(--radius-control)] px-3 py-2 hover:bg-[var(--control-surface)]">
                    <b>{{ book.title }}</b><span class="text-[var(--text-sm)] text-[var(--text-muted)]">{{ book.chapters }} 章</span>
                </RouterLink>
            </li>
        </ul>
    </main>
</template>
