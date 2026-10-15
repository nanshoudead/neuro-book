<script setup lang="ts">
/**
 * 说明与统计（docs/specs/story/viewer.md 输出 17）：来源、抽取到的位置、到阅读位置为止各类记录的数量；三张图（逐章
 * 记录量、人物出场热力、悬念累计），点一章打开原文页的这一章；全书抽取统计注明是全书的、不随阅读位置变。
 */
import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import CastHeatmap from "../parts/CastHeatmap.vue";
import ChapterBars from "../parts/ChapterBars.vue";
import PageState from "../parts/PageState.vue";
import QuestionCurve from "../parts/QuestionCurve.vue";

const book = useBook();
const stats = useStoryQuery("book.stats", () => ({}));
function openChapter(chapter: number): void {
    book.sourceChapter.value = chapter;
    book.goPage("source");
}
const LABEL: Record<string, string> = {
    entities: "对象", names: "称呼", mentions: "称呼出现", statements: "说法", secrets: "秘密", knowledge: "知情记录", episodes: "情节", ledger: "数值流水",
    questions: "悬念", questionUpdates: "悬念进展", times: "时间点", beats: "段落概要", summaries: "人物归纳", arcs: "当前主线", mentionNotes: "指定称呼",
    episodeLinks: "情节连接", merges: "合并", statementKinds: "说法分类", statementTimes: "说法时间", timeOrder: "时间排序", nameFirstSeen: "称呼首次出现", ledgerTotals: "数值累加",
};
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-stats">
        <div class="story-page-body">
            <h1 class="story-page-title">说明与统计</h1>
            <section class="story-block">
                <h2>这本书</h2>
                <p class="text-[length:var(--text-sm)]">{{ book.info.title }}；来源 {{ book.info.source.title }}（{{ book.info.source.file }}）；共 {{ book.info.chapters }} 章，抽取到第 {{ book.info.extractedThrough.chapter }} 章第 {{ book.info.extractedThrough.paragraph }} 段。</p>
                <p class="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">记录由程序从原文自动抽取，可能漏记或记错，结论以原文为准。</p>
            </section>
            <PageState :loading="stats.loading.value && !stats.data.value" :error="stats.error.value?.message ?? null" @retry="stats.reload()" />
            <template v-if="stats.data.value">
                <section class="story-block" data-testid="stats-charts">
                    <h2>逐章记录量 <span class="sub">点一章看原文</span></h2>
                    <ChapterBars :rows="stats.data.value.chapters" :total="book.info.chapters" @select="openChapter" />
                </section>
                <section class="story-block">
                    <h2>主要人物逐章出场 <span class="sub">颜色越深，这一章被提到得越多</span></h2>
                    <CastHeatmap :cast="stats.data.value.cast" :total="book.info.chapters" @select="openChapter" />
                </section>
                <section class="story-block">
                    <h2>悬念 <span class="sub">逐章累计</span></h2>
                    <QuestionCurve :rows="stats.data.value.chapters" :total="book.info.chapters" @select="openChapter" />
                </section>
                <section class="story-block">
                    <h2>到{{ book.atLabel.value }}为止的记录</h2>
                    <table class="story-table" data-testid="visible-stats">
                        <tbody><tr v-for="(count, key) in stats.data.value.visible" :key="key"><th>{{ LABEL[key] ?? key }}</th><td>{{ count }}</td></tr></tbody>
                    </table>
                </section>
                <section class="story-block">
                    <h2>全书抽取统计 <span class="sub">全书的，不随阅读位置变</span></h2>
                    <div class="flex flex-wrap gap-8">
                        <table class="story-table">
                            <thead><tr><th colspan="2">草稿写了多少条</th></tr></thead>
                            <tbody><tr v-for="(count, key) in stats.data.value.extraction.written" :key="key"><th>{{ LABEL[key] ?? key }}</th><td>{{ count }}</td></tr></tbody>
                        </table>
                        <table class="story-table">
                            <thead><tr><th colspan="2">程序生成了多少条</th></tr></thead>
                            <tbody><tr v-for="(count, key) in stats.data.value.extraction.generated" :key="key"><th>{{ LABEL[key] ?? key }}</th><td>{{ count }}</td></tr></tbody>
                        </table>
                    </div>
                    <p class="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">原文共 {{ stats.data.value.extraction.chars }} 字。</p>
                </section>
            </template>
        </div>
    </div>
</template>
