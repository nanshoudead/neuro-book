<script setup lang="ts">
/**
 * 全书总览（docs/specs/story/viewer.md 输出 8）：主要人物（含读者此时知道的化名）、最近更新的几条主线、精简的秘密
 * 矩阵、未解悬念数与最近有进展的几条、数值余额与进行中的任务数、这一章发生了什么；各块可点进对应的页，每一条都能
 * 点：经 book.jump 打开对应的页并定位到它。
 */
import {computed} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";

const book = useBook();
/** 总览里列几个主要人物、几条主线。 */
const CAST = 8;
const ARCS = 6;

const roster = useStoryQuery("entities.list", () => ({limit: 50}));
// 主要人物：出场最多的人物与身份（合并了化名的点，代表对象可能是“身份”类）。
const cast = computed(() => (roster.data.value?.items ?? []).filter(item => item.kind === "person" || item.kind === "persona").slice(0, CAST));
const arcs = useStoryQuery("arcs.list", () => ({}));
const matrix = useStoryQuery("secrets.matrix", () => ({}));
const open = useStoryQuery("questions.list", () => ({state: "open", limit: 1}) as const);
/** 最近有进展的几条没解开的悬念。 */
const RECENT_QUESTIONS = 5;
const recentQuestions = useStoryQuery("questions.list", () => ({state: "partial", sort: "recent", limit: RECENT_QUESTIONS}) as const);
const partial = useStoryQuery("questions.list", () => ({state: "partial", limit: 1}) as const);
const ledger = useStoryQuery("ledger.tracks", () => ({}));
const digest = useStoryQuery("chapter.digest", () => ({chapter: book.at.value.chapter}));

const resources = computed(() => (ledger.data.value?.tracks ?? []).filter(track => track.kind === "resource" && typeof track.current === "number").slice(0, 3));
const activeTasks = computed(() => (ledger.data.value?.tracks ?? []).filter(track => track.kind === "task" && typeof track.current === "string" && track.current.startsWith("进行中")).length);
const recentArcs = computed(() => (arcs.data.value?.arcs ?? []).slice(-ARCS).reverse());
const compactColumns = computed(() => (matrix.data.value?.columns ?? []).slice(0, 6));
function continueReading(): void {
    book.sourceChapter.value = book.at.value.chapter;
    book.goPage("source");
}
function signed(value: number | null): string {
    return value === null ? "" : value > 0 ? `+${value}` : String(value);
}
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-overview">
        <div class="story-page-body">
            <h1 class="story-page-title">全书总览 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <div class="tiles">
                <button type="button" class="tile" @click="book.goPage('roster')"><b>{{ roster.data.value?.total ?? "…" }}</b><span>人物与事物</span></button>
                <button type="button" class="tile" @click="book.goPage('secrets')"><b>{{ matrix.data.value?.rows.length ?? "…" }}</b><span>身份秘密</span><small>读者已知 {{ matrix.data.value?.rows.filter(row => row.revealedAt).length ?? 0 }}</small></button>
                <button type="button" class="tile" @click="book.goPage('questions')"><b>{{ (open.data.value?.total ?? 0) + (partial.data.value?.total ?? 0) }}</b><span>未解悬念</span><small>其中 {{ partial.data.value?.total ?? 0 }} 条有进展</small></button>
                <button type="button" class="tile" @click="book.goPage('ledger')">
                    <b>{{ resources[0]?.current ?? "—" }}</b><span>{{ resources[0] ? `${resources[0].name}余额` : "数值" }}</span><small>进行中的任务 {{ activeTasks }} 个</small>
                </button>
            </div>

            <div class="grid-2">
                <section class="story-block">
                    <h2>主要人物 <button type="button" class="more" @click="book.goPage('roster')">全部</button></h2>
                    <PageState :loading="roster.loading.value && !roster.data.value" :error="roster.error.value?.message ?? null" @retry="roster.reload()" />
                    <ul class="flex flex-col gap-1">
                        <li v-for="person in cast" :key="person.id" class="flex items-baseline gap-2 text-[length:var(--text-sm)]">
                            <NameLink :id="person.id" :label="person.label" strong />
                            <span class="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ person.names.top.filter(name => name !== person.label).slice(0, 3).join("、") }}</span>
                            <span class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]">出场 {{ person.mentions }}</span>
                        </li>
                    </ul>
                </section>
                <section class="story-block">
                    <h2>主线 <span class="sub">归纳到第 {{ arcs.data.value?.through ?? "—" }} 章</span><button type="button" class="more" @click="book.goPage('episodes')">情节</button></h2>
                    <PageState :loading="arcs.loading.value && !arcs.data.value" :error="arcs.error.value?.message ?? null" @retry="arcs.reload()" />
                    <p v-if="arcs.data.value && recentArcs.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">还没有主线</p>
                    <ul class="flex flex-col gap-1">
                        <li v-for="arc in recentArcs" :key="arc.id" class="text-[length:var(--text-sm)]">
                            <button type="button" class="entry" :title="arc.summary" data-testid="overview-arc" @click="book.jump('episodes', {kind: 'arc', id: arc.id})"><b>{{ arc.title }}</b></button>
                            <span class="ml-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ arc.status === "ongoing" ? "进行中" : "已结束" }} · {{ arc.episodes.length }} 段</span>
                        </li>
                    </ul>
                </section>
            </div>

            <section class="story-block">
                <h2>秘密矩阵 <span class="sub">精简</span><button type="button" class="more" @click="book.goPage('secrets')">完整矩阵</button></h2>
                <PageState :loading="matrix.loading.value && !matrix.data.value" :error="matrix.error.value?.message ?? null" @retry="matrix.reload()" />
                <div v-if="matrix.data.value" class="overflow-x-auto">
                    <table class="story-table">
                        <thead><tr><th>秘密</th><th v-for="column in compactColumns" :key="column.id"><NameLink v-if="column.id !== 'reader'" :id="column.id" :label="column.label" /><template v-else>{{ column.label }}</template></th></tr></thead>
                        <tbody>
                            <tr v-for="row in matrix.data.value.rows" :key="row.id">
                                <td><button type="button" class="entry text-left" data-testid="overview-secret" @click="book.jump('secrets', {kind: 'secret', id: row.id})">{{ row.title }}</button></td>
                                <td v-for="column in compactColumns" :key="column.id"><StateBadge :state="row.cells.find(cell => cell.column === column.id)!.state" /></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="story-block">
                <h2>最近有进展的悬念 <span class="sub">共 {{ partial.data.value?.total ?? "…" }} 条有进展</span><button type="button" class="more" @click="book.goPage('questions')">全部悬念</button></h2>
                <PageState :loading="recentQuestions.loading.value && !recentQuestions.data.value" :error="recentQuestions.error.value?.message ?? null" @retry="recentQuestions.reload()" />
                <ul class="flex flex-col gap-1 text-[length:var(--text-sm)]">
                    <li v-for="question in recentQuestions.data.value?.items ?? []" :key="question.id" class="flex items-baseline gap-2">
                        <button type="button" class="entry min-w-0 flex-1 text-left" data-testid="overview-question" @click="book.jump('questions', {kind: 'question', id: question.id})">{{ question.text }}</button>
                        <span class="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">第 {{ question.updates.at(-1)?.chapter ?? question.raised.chapter }} 章</span>
                    </li>
                </ul>
            </section>

            <section class="story-block">
                <h2>第 {{ book.at.value.chapter }} 章发生了什么<button type="button" class="more" data-testid="continue-reading" @click="continueReading"><span class="i-lucide-book-open align-[-2px]" /> 继续读</button></h2>
                <PageState :loading="digest.loading.value && !digest.data.value" :error="digest.error.value?.message ?? null" @retry="digest.reload()" />
                <div v-if="digest.data.value" class="flex flex-col gap-2 text-[length:var(--text-sm)]">
                    <ul class="flex flex-col gap-1">
                        <li v-for="episode in digest.data.value.episodes" :key="episode.id">
                            <button type="button" class="entry" @click="book.jump('episodes', {kind: 'episode', id: episode.id})"><b>{{ episode.title }}</b></button>：{{ episode.summary }} <RefLink v-if="episode.refs[0]" :ref-text="episode.refs[0]" />
                        </li>
                    </ul>
                    <p v-if="digest.data.value.newEntities.length" class="digest-line"><span class="label">新出场</span><NameLink v-for="entity in digest.data.value.newEntities" :id="entity.id" :key="entity.id" :label="entity.label" class="mr-1.5" /></p>
                    <p v-if="digest.data.value.revealedSecrets.length" class="digest-line">
                        <span class="label">揭晓</span>
                        <span v-for="secret in digest.data.value.revealedSecrets" :key="secret.id" class="mr-2"><button type="button" class="entry" @click="book.jump('secrets', {kind: 'secret', id: secret.id})">{{ secret.title }}</button> <RefLink :ref-text="secret.ref" /></span>
                    </p>
                    <p v-if="digest.data.value.ledger.length" class="digest-line">
                        <span class="label">数值</span>
                        <span v-for="(entry, index) in digest.data.value.ledger" :key="index" class="mr-2">{{ entry.owner.label }} {{ entry.track }} {{ signed(entry.change) || entry.value || entry.op }} <RefLink :ref-text="entry.ref" /></span>
                    </p>
                    <p v-if="digest.data.value.questions.raised.length || digest.data.value.questions.progressed.length" class="digest-line">
                        <span class="label">悬念</span>
                        <span v-for="question in digest.data.value.questions.raised" :key="`r-${question.id}`" class="mr-2">新提出：<button type="button" class="entry" @click="book.jump('questions', {kind: 'question', id: question.id})">{{ question.text }}</button></span>
                        <span v-for="question in digest.data.value.questions.progressed" :key="`p-${question.id}-${question.ref}`" class="mr-2">{{ question.type === "answered" ? "解答" : "进展" }}：<button type="button" class="entry" @click="book.jump('questions', {kind: 'question', id: question.id})">{{ question.text }}</button></span>
                    </p>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
}
.tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    text-align: left;
}
.tile:hover {
    background: var(--bg-hover);
}
.tile b {
    font-size: var(--text-xl);
}
.tile span {
    font-size: var(--text-sm);
}
.tile small {
    font-size: var(--text-2xs);
    color: var(--text-muted);
}
.grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 0 24px;
}
.entry {
    color: inherit;
}
.entry:hover {
    color: var(--accent-text);
    text-decoration: underline;
}
.digest-line {
    line-height: 1.8;
}
.digest-line .label {
    display: inline-block;
    width: 3.5em;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.more {
    margin-left: 8px;
    font-size: var(--text-xs);
    font-weight: normal;
    color: var(--accent-text);
}
</style>
