<script setup lang="ts">
/**
 * 人物名册（docs/specs/story/viewer.md 输出 9）：按出场次数排，主要人物在前、列出称呼；其余的按出场次数列出，
 * 次要的默认收起。点一个人在抽屉里打开人物卡。
 */
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {KIND_LABEL} from "../host/kinds";
import {usePagedQuery, useStoryQuery} from "../host/query";
import PagedList from "../parts/PagedList.vue";
import PageState from "../parts/PageState.vue";

const book = useBook();
/** 主要人物个数；出场少于这个数的算次要，默认收起。 */
const MAIN = 8;
const MINOR_BELOW = 20;

// 主要人物：出场最多的人物与身份（化名合并后代表对象可能是“身份”类）。名册第一页按出场排好，从里面取。
const head = useStoryQuery("entities.list", () => ({limit: 50}));
const main = computed(() => (head.data.value?.items ?? []).filter(item => item.kind === "person" || item.kind === "persona").slice(0, MAIN));
const all = usePagedQuery("entities.list", () => ({}), 200);
const showMinor = ref(false);
const mainIds = computed(() => new Set(main.value.map(item => item.id)));
const others = computed(() => all.items.value.filter(item => !mainIds.value.has(item.id)));
const visibleOthers = computed(() => (showMinor.value ? others.value : others.value.filter(item => item.mentions >= MINOR_BELOW)));
const minorCount = computed(() => (all.total.value === null ? null : all.total.value - mainIds.value.size - others.value.filter(item => item.mentions >= MINOR_BELOW).length));
const selected = computed(() => (book.drawer.value?.kind === "card" ? book.drawer.value.entity : null));
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-roster">
        <div class="story-page-body">
            <h1 class="story-page-title">人物 <span class="sub">按出场次数，截至{{ book.atLabel.value }}，共 {{ all.total.value ?? "…" }} 个</span></h1>
            <section class="story-block">
                <h2>主要人物</h2>
                <PageState :loading="head.loading.value && !head.data.value" :error="head.error.value?.message ?? null" @retry="head.reload()" />
                <ul class="roster">
                    <li v-for="person in main" :key="person.id">
                        <button type="button" class="main-card" :class="selected === person.id ? 'is-selected' : ''" data-testid="roster-main" @click="book.openCard(person.id)">
                            <div class="flex items-baseline gap-2"><b>{{ person.label }}</b><span class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ person.mentions }}</span></div>
                            <div class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ person.names.top.join("、") }}<template v-if="person.names.total > person.names.top.length"> 等 {{ person.names.total }} 个称呼</template></div>
                        </button>
                    </li>
                </ul>
            </section>
            <section class="story-block">
                <h2>其他</h2>
                <PagedList :items="visibleOthers" :total="all.total.value" :loading="all.loading.value" :has-more="showMinor && all.hasMore.value" :error="all.error.value?.message ?? null" @more="all.more()" @retry="all.reload()">
                    <template #item="{item}">
                        <button type="button" class="other-row" :class="selected === item.id ? 'is-selected' : ''" @click="book.openCard(item.id)">
                            <b>{{ item.label }}</b><span class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ KIND_LABEL[item.kind] }}</span>
                            <span class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ item.mentions }}</span>
                        </button>
                    </template>
                </PagedList>
                <button type="button" class="mt-2 text-[length:var(--text-sm)] text-[var(--accent-text)]" data-testid="toggle-minor" @click="showMinor = !showMinor">{{ showMinor ? "收起次要" : `展开次要${minorCount !== null ? `（${minorCount}）` : ""}` }}</button>
            </section>
        </div>
    </div>
</template>

<style scoped>
.roster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px;
}
.main-card {
    display: block;
    width: 100%;
    height: 100%;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    text-align: left;
}
.main-card:hover,
.other-row:hover {
    background: var(--bg-hover);
}
.main-card.is-selected,
.other-row.is-selected {
    background: var(--accent-bg);
}
.other-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    text-align: left;
}
</style>
