<script setup lang="ts">
/**
 * 人物卡关系页签里展开的一行（docs/specs/story/viewer.md 输出 10）：两个对象之间的身份连接、全部说法（按类别筛，
 * 最近的在前）、一起出场的情节、互相知道的事。数据来自 `entity.relation`。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import RecordTags from "../parts/RecordTags.vue";
import RefLink from "../parts/RefLink.vue";

const props = defineProps<{entity: string; other: string}>();
const book = useBook();
const detail = useStoryQuery("entity.relation", () => ({entity: props.entity, other: props.other}));

/** 每块先列几条，其余点“全部”再展开。 */
const SHOWN = 6;
const FAMILY: Record<string, string> = {
    kinship: "亲属", social: "交往", membership: "所属", attitude: "态度", identity: "身份", event: "事件", goal: "打算", trait: "特点",
    rule: "规则", possession: "拥有", location: "位置", other: "其他",
};
const RELATION = new Set(["kinship", "social", "membership"]);
const IDENTITY = {
    uncertain: "可能是同一人：有说法把两者连成同一身份，但读者此时还不能确定",
    unaware: "其实是同一人，但这个视角的人物不知道",
    heard: "其实是同一人，这个视角的人物听说过",
    believes: "其实是同一人，这个视角的人物这样认为",
    suspects: "其实是同一人，这个视角的人物有所怀疑",
    "no-record": "其实是同一人，没有记录这个视角的人物知不知道",
} as const;
const STATE = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道"} as const;

const family = ref<"all" | "relation" | "attitude" | "other">("all");
const allStatements = ref(false);
const allEpisodes = ref(false);
const statements = computed(() => {
    const list = [...(detail.data.value?.statements ?? [])].reverse();
    return list.filter(item => family.value === "all" || (family.value === "relation" ? RELATION.has(item.family) : family.value === "attitude" ? item.family === "attitude" : !RELATION.has(item.family) && item.family !== "attitude"));
});
const familyOptions = computed(() => {
    const list = detail.data.value?.statements ?? [];
    const count = (test: (family: string) => boolean) => list.filter(item => test(item.family)).length;
    return [
        {value: "all", label: `全部 ${list.length}`},
        {value: "relation", label: `关系 ${count(item => RELATION.has(item))}`},
        {value: "attitude", label: `态度 ${count(item => item === "attitude")}`},
        {value: "other", label: `其他 ${count(item => !RELATION.has(item) && item !== "attitude")}`},
    ];
});
const episodes = computed(() => [...(detail.data.value?.episodes ?? [])].reverse());
</script>

<template>
    <div class="relation-detail" data-testid="relation-detail">
        <PageState :loading="detail.loading.value && !detail.data.value" :error="detail.error.value?.message ?? null" @retry="detail.reload()" />
        <template v-if="detail.data.value">
            <p v-if="detail.data.value.identity" class="identity">{{ IDENTITY[detail.data.value.identity] }}</p>

            <section v-if="detail.data.value.statements.length">
                <div class="flex flex-wrap items-center gap-2">
                    <h4>两人之间的说法</h4>
                    <SegmentedControl v-model="family" size="xs" :options="familyOptions" aria-label="说法的类别" />
                </div>
                <ul class="rows">
                    <li v-for="item in allStatements ? statements : statements.slice(0, SHOWN)" :key="item.id" class="row">
                        <span class="kind">{{ FAMILY[item.family] ?? item.family }}</span>
                        <span class="min-w-0">
                            {{ item.text }}
                            <RecordTags :tags="item.tags" />
                        </span>
                        <span class="refs"><RefLink v-for="ref in item.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></span>
                    </li>
                </ul>
                <button v-if="statements.length > SHOWN" type="button" class="more" @click="allStatements = !allStatements">{{ allStatements ? "收起" : `全部 ${statements.length} 条` }}</button>
            </section>

            <section v-if="episodes.length">
                <h4>一起出场的情节 <span class="count">{{ episodes.length }} 段</span></h4>
                <ul class="rows">
                    <li v-for="episode in allEpisodes ? episodes : episodes.slice(0, SHOWN)" :key="episode.id" class="row">
                        <span class="kind">第 {{ episode.chapter }} 章</span>
                        <button type="button" class="min-w-0 text-left text-[var(--accent-text)]" @click="book.jump('episodes', {kind: 'episode', id: episode.id})">{{ episode.title }}</button>
                        <span class="refs"><RefLink v-for="ref in episode.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></span>
                    </li>
                </ul>
                <button v-if="episodes.length > SHOWN" type="button" class="more" @click="allEpisodes = !allEpisodes">{{ allEpisodes ? "收起" : `全部 ${episodes.length} 段` }}</button>
            </section>

            <section v-if="detail.data.value.knows && (detail.data.value.knows.ab.length || detail.data.value.knows.ba.length)">
                <template v-for="side in (['ab', 'ba'] as const)" :key="side">
                    <template v-if="detail.data.value.knows[side].length">
                        <h4>{{ side === "ab" ? detail.data.value.a.label : detail.data.value.b.label }}知道的关于{{ side === "ab" ? detail.data.value.b.label : detail.data.value.a.label }}的事 <span class="count">最近 {{ detail.data.value.knows[side].length }} 条</span></h4>
                        <ul class="rows">
                            <li v-for="(item, index) in [...detail.data.value.knows[side]].reverse().slice(0, SHOWN)" :key="index" class="row">
                                <span class="kind">{{ STATE[item.state] }}</span>
                                <span class="min-w-0">{{ item.text }}<span v-if="item.how" class="how">（{{ item.how }}）</span></span>
                                <span class="refs"><RefLink v-for="ref in item.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></span>
                            </li>
                        </ul>
                    </template>
                </template>
            </section>

            <p v-if="!detail.data.value.identity && !detail.data.value.statements.length && !episodes.length && !(detail.data.value.knows && (detail.data.value.knows.ab.length || detail.data.value.knows.ba.length))" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                在当前视角与阅读位置下两者之间没有记录
            </p>
        </template>
    </div>
</template>

<style scoped>
.relation-detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 0 10px 22px;
}
h4 {
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
}
.count {
    font-weight: normal;
    color: var(--text-muted);
}
.identity {
    padding: 4px 8px;
    border-radius: var(--radius-control);
    background: var(--status-warning-bg);
    font-size: var(--text-xs);
}
.rows {
    margin-top: 4px;
}
/* 一行三列：类别或状态 | 正文 | 出处，逐行对齐，方便一行行扫 */
.row {
    display: grid;
    grid-template-columns: 4em minmax(0, 1fr) auto;
    gap: 8px;
    align-items: baseline;
    padding: 3px 0;
    border-bottom: var(--border-w, 1px) solid var(--divider);
    font-size: var(--text-sm);
    line-height: 1.55;
}
.kind {
    font-size: var(--text-2xs);
    color: var(--text-secondary);
}
.refs {
    font-size: var(--text-2xs);
    white-space: nowrap;
}
.how {
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.more {
    align-self: flex-start;
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--accent-text);
}
</style>
