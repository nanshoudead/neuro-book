<script setup lang="ts">
/**
 * 原文（docs/specs/story/viewer.md 输出 16、F3）：左侧目录（可收起），正文段落带段号，称呼带底色可点；打开“段落概要”
 * 后概要插在它所概括的那几段之前；段号旁标出被引用的记录条数，点开在抽屉里列出。阅读位置精确到段时，正文里有一条
 * “读到这里”的线，线之后的段落不标记录。之后的章在目录里只写章号与“未读”，点不开。
 */
import {IconButton} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import SourceText from "../parts/SourceText.vue";

const book = useBook();
// 正在看的章在会话里（写进地址的 chapter）；没写时是阅读位置所在章。阅读位置变了回到新位置所在章。
const chapter = computed({
    get: () => book.sourceChapter.value ?? book.at.value.chapter,
    set: value => {
        book.sourceChapter.value = value === book.at.value.chapter ? null : value;
    },
});
watch(() => book.at.value.chapter, () => {
    book.sourceChapter.value = null;
});
// 手机宽度下目录默认收起，正文才有地方（输出 33）。
const tocOpen = ref(book.tier.value !== "phone");
const showBeats = ref(false);
const body = ref<HTMLElement | null>(null);
// 换章回到顶部，不停在上一章滚到的位置。
watch(chapter, () => body.value?.scrollTo({top: 0}));
const beyond = computed(() => chapter.value > book.at.value.chapter);
const toc = useStoryQuery("book.info", () => ({}));
const source = useStoryQuery("source.read", () => (beyond.value ? null : {from: {chapter: chapter.value}}));
const readLine = computed(() => (book.at.value.paragraph !== undefined && chapter.value === book.at.value.chapter ? book.at.value.paragraph : null));
</script>

<template>
    <div class="story-page flex" data-testid="page-source">
        <aside v-if="tocOpen" class="story-scroll-y w-[200px] shrink-0 border-r border-[var(--divider)] py-2" aria-label="目录">
            <div class="flex items-center px-2 pb-1"><b class="text-[length:var(--text-sm)]">目录</b><IconButton class="ml-auto" size="xs" icon-class="i-lucide-panel-left-close" aria-label="收起目录" @click="tocOpen = false" /></div>
            <button
                v-for="item in toc.data.value?.toc ?? []" :key="item.chapter" type="button" class="toc-item"
                :class="[item.chapter === chapter ? 'is-active' : '', item.title === null ? 'is-unread' : '']" :disabled="item.title === null" :data-chapter="item.chapter"
                @click="chapter = item.chapter"
            >
                <template v-if="item.title !== null">{{ item.title }}</template><template v-else>第 {{ item.chapter }} 章 · 未读</template>
            </button>
        </aside>
        <div ref="body" class="story-scroll-y min-w-0 flex-1">
            <div class="mx-auto max-w-[760px] px-4 py-3">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                    <IconButton v-if="!tocOpen" size="xs" icon-class="i-lucide-panel-left-open" aria-label="展开目录" @click="tocOpen = true" />
                    <h1 class="story-page-title mb-0">原文</h1>
                    <button type="button" class="story-chip" :class="showBeats ? 'is-on' : ''" :aria-pressed="showBeats" data-testid="toggle-beats" @click="showBeats = !showBeats">段落概要</button>
                    <span class="ml-auto flex items-center gap-1">
                        <IconButton size="xs" icon-class="i-lucide-chevron-left" aria-label="上一章" :disabled="chapter <= 1" @click="chapter -= 1" />
                        <IconButton size="xs" icon-class="i-lucide-chevron-right" aria-label="下一章" :disabled="chapter >= book.at.value.chapter" @click="chapter += 1" />
                    </span>
                </div>
                <div v-if="beyond" class="py-6" data-testid="beyond-position">
                    <p>第 {{ chapter }} 章还没读到。</p>
                    <button type="button" class="mt-2 text-[var(--accent-text)] underline" @click="book.setAt({chapter})">把阅读位置拨到第 {{ chapter }} 章</button>
                </div>
                <template v-else>
                    <PageState :loading="source.loading.value && !source.data.value" :error="source.error.value?.message ?? null" @retry="source.reload()" />
                    <template v-for="paragraph in source.data.value?.paragraphs ?? []" :key="paragraph.paragraph">
                        <p v-if="showBeats && paragraph.beat" class="beat" data-testid="beat" :data-from="paragraph.beat.from">{{ paragraph.beat.gist }} <span class="text-[length:var(--text-2xs)]">（{{ paragraph.beat.from }}—{{ paragraph.beat.to }} 段）</span></p>
                        <p class="source-para" :data-paragraph="paragraph.paragraph">
                            <button v-if="paragraph.recordCount > 0" type="button" class="para-no has-records" :title="`${paragraph.recordCount} 条记录引用这一段`" @click="book.openParagraph(paragraph.chapter, paragraph.paragraph)">{{ paragraph.paragraph }}<sup>{{ paragraph.recordCount }}</sup></button>
                            <span v-else class="para-no">{{ paragraph.paragraph }}</span>
                            <SourceText :text="paragraph.text" :names="paragraph.names" />
                        </p>
                        <div v-if="readLine === paragraph.paragraph" class="read-line" data-testid="read-line">读到这里</div>
                    </template>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.toc-item {
    display: block;
    width: 100%;
    padding: 3px 10px;
    font-size: var(--text-xs);
    text-align: left;
    color: var(--text-secondary);
}
.toc-item:hover:not(:disabled) {
    background: var(--bg-hover);
}
.toc-item.is-active {
    color: var(--accent-text);
    background: var(--accent-bg);
}
.toc-item.is-unread {
    color: var(--text-muted);
    cursor: default;
}
.source-para {
    line-height: 1.85;
    margin: 4px 0;
}
.para-no {
    display: inline-block;
    min-width: 2.2em;
    margin-right: 4px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}
.para-no.has-records {
    color: var(--accent-text);
}
.para-no sup {
    margin-left: 1px;
}
.beat {
    margin: 10px 0 2px;
    padding: 4px 8px;
    border-left: 3px solid var(--border-accent);
    background: var(--bg-subtle);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.read-line {
    margin: 8px 0;
    border-top: 2px dashed var(--status-warning);
    font-size: var(--text-2xs);
    color: var(--status-warning);
    text-align: right;
}
</style>
