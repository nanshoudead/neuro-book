<script setup lang="ts">
/**
 * 记录等级的小色块（viewer 输出 56、57）。给了 `explain` 时可以点开看依据：打开才取 `tier.explain`，文字来自 tier-words.ts。
 */
import {Badge, Popover} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import {citedWords, echoWords, FLAG_WORDS, TIER_WORDS, tierVerdict} from "./tier-words";

const props = defineProps<{
    tier: 1 | 2 | 3 | null;
    flag?: "unconfirmed" | "foreshadow" | null;
    /** 说法的 id；给了才能点开看依据。情节不给（输出 56：情节的色块不能点）。 */
    explain?: string;
    /** 说法的类别（没有先验时写进依据）。 */
    family?: string;
}>();
const book = useBook();
const open = ref(false);
const explained = useStoryQuery("tier.explain", () => (open.value && props.explain ? {id: props.explain} : null));
const verdict = computed(() => (explained.data.value ? tierVerdict(explained.data.value, props.family ?? null, {atEnd: book.atEnd.value, label: book.atLabel.value}) : ""));
const title = computed(() => (props.tier === null ? "" : `${props.tier} 级（${TIER_WORDS[props.tier]}）${props.explain ? "，点开看为什么" : ""}`));
</script>

<template>
    <template v-if="props.tier !== null">
        <Popover v-if="props.explain" v-model:open="open" align="start" :side-offset="7" content-class="w-[min(300px,92vw)]">
            <template #trigger>
                <button type="button" class="tier-badge" :data-tier="props.tier" :title="title" :aria-label="title" data-testid="tier-badge">{{ props.tier }}</button>
            </template>
            <div class="tier-explain" data-testid="tier-explain">
                <div class="head">
                    <span class="tier-badge" :data-tier="props.tier">{{ props.tier }}</span>{{ props.tier }} 级
                    <Badge v-if="props.flag" size="sm" variant="soft" tone="neutral" class="ml-1.5 font-normal">{{ FLAG_WORDS[props.flag] }}</Badge>
                </div>
                <p v-if="explained.error.value" class="verdict text-[var(--status-danger)]">依据没取到：{{ explained.error.value.message }}</p>
                <p v-else-if="!explained.data.value" class="verdict text-[var(--text-secondary)]">正在取依据……</p>
                <template v-else>
                    <p class="verdict">{{ verdict }}</p>
                    <dl>
                        <dt>后文引用</dt>
                        <dd>{{ citedWords(explained.data.value) }}</dd>
                        <dt>后文又提到</dt>
                        <dd>{{ echoWords(explained.data.value) }}</dd>
                    </dl>
                </template>
                <div class="foot">只看你读到的位置之前的内容；往后读，等级可能会变。</div>
            </div>
        </Popover>
        <span v-else class="tier-badge" :data-tier="props.tier" :title="title" data-testid="tier-badge">{{ props.tier }}</span>
    </template>
</template>

<style scoped>
/* 方形、只放一个数字、还要当按钮用，nb-ui 的 Badge 是带内边距的标签，不合用；字号与圆角取 Badge sm 的那一档。 */
.tier-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.45em;
    height: 1.45em;
    margin-right: var(--space-3);
    border-radius: max(2px, calc(var(--radius-control) - 2px));
    font-size: var(--text-2xs);
    font-weight: 700;
    line-height: 1;
    vertical-align: 1px;
}
.tier-badge[data-tier="1"] {
    background: var(--accent-main);
    color: var(--text-inverse);
}
.tier-badge[data-tier="2"] {
    border: 1px solid var(--accent-main);
    color: var(--accent-main);
}
.tier-badge[data-tier="3"] {
    border: 1px solid var(--divider);
    color: var(--text-muted);
}
button.tier-badge {
    cursor: pointer;
}
button.tier-badge:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 1px;
}
/* Popover 的面板整体不可选；依据是要能复制的文字。 */
.tier-explain {
    user-select: text;
    font-size: var(--text-sm);
    line-height: 1.6;
}
.tier-explain .head {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
    font-weight: 600;
}
.tier-explain .verdict {
    margin: 0 0 8px;
}
.tier-explain dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: var(--text-xs);
}
.tier-explain dt {
    color: var(--text-secondary);
}
.tier-explain dd {
    margin: 0;
}
.tier-explain .foot {
    margin-top: 8px;
    padding-top: 6px;
    border-top: var(--border-w, 1px) solid var(--divider);
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
