<script setup lang="ts">
/** 案头（同名 .md）：统计、最近写到与看板娘；空书架时是问候。只发事件。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {continueTarget, formatBooks, formatFiles, formatSigned, formatWhen, formatWords, recentPieces, shelfTotals} from "../shelf-format";

defineOptions({name: "ShelfDesk"});

const props = defineProps<{
    locale: DisplayLocale;
    items: ReadonlyArray<ShelfItem>;
    now: string;
}>();

const emit = defineEmits<{
    (event: "continue", id: string): void;
}>();

const TEXT = {
    label: {"zh-CN": "案头", "en-US": "Desk"},
    todayLabel: {"zh-CN": "今天写了字", "en-US": "words today"},
    totalLabel: {"zh-CN": "共写了字", "en-US": "words in all"},
    total: {"zh-CN": "共 {words}", "en-US": "{words} in total"},
    continueBook: {"zh-CN": "继续写作《{title}》", "en-US": "Continue “{title}”"},
    recent: {"zh-CN": "最近写到", "en-US": "Recently Written"},
    noRecord: {"zh-CN": "打开一部作品写几个字，这里会记下你写到哪了。", "en-US": "Open a book and write a little; what you wrote last shows up here."},
    emptyTitle: {"zh-CN": "书架还是空的", "en-US": "The shelf is empty"},
    emptyLead: {"zh-CN": "在 NeuroBook 里，一部作品就是你电脑上的一个文件夹：章节、设定都是里面的 Markdown 文件，随时可以备份、同步，或者用别的编辑器打开。", "en-US": "In NeuroBook a book is a folder on your computer: chapters and notes are Markdown files inside it, so you can back it up, sync it, or open it in any editor."},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
const totals = computed(() => shelfTotals(props.items));
const target = computed(() => continueTarget(props.items));
const recent = computed(() => recentPieces(props.items, 3));
const headline = computed(() => (totals.value.today === null
    ? {number: formatWords(totals.value.words, props.locale).replace(/\s*(字|words)$/u, ""), label: text(TEXT.totalLabel)}
    : {number: formatSigned(totals.value.today, props.locale), label: text(TEXT.todayLabel)}));
</script>

<template>
    <section class="shelf-desk" :class="{'shelf-desk--empty': items.length === 0}" :aria-label="text(TEXT.label)" data-shelf-desk>
        <!-- 容器查询只对后代生效：section 当容器，网格放在里面这一层，窄时才换得了列模板。 -->
        <div class="shelf-desk__grid">
        <template v-if="items.length === 0">
            <div class="shelf-desk__greeting">
                <h1 class="shelf-desk__title">{{ text(TEXT.emptyTitle) }}</h1>
                <p class="shelf-desk__lead">{{ text(TEXT.emptyLead) }}</p>
            </div>
        </template>
        <template v-else>
            <div class="shelf-desk__stats" data-shelf-stats>
                <p class="shelf-desk__headline"><span class="shelf-desk__number">{{ headline.number }}</span><span class="shelf-desk__unit">{{ headline.label }}</span></p>
                <p class="shelf-desk__totals">
                    <span v-if="totals.today !== null">{{ text(formatText(TEXT.total, {words: formatWords(totals.words, locale)})) }}</span>
                    <span>{{ formatFiles(totals.files, locale) }}</span>
                    <span>{{ formatBooks(totals.books, locale) }}</span>
                </p>
                <Button v-if="target !== null" variant="primary" class="shelf-desk__continue" data-continue @click="emit('continue', target.id)">{{ text(formatText(TEXT.continueBook, {title: projectDisplayName(target)})) }} →</Button>
            </div>
            <div class="shelf-desk__recent" data-shelf-recent>
                <h2 class="shelf-desk__eyebrow">{{ text(TEXT.recent) }}</h2>
                <p v-if="recent.length === 0" class="shelf-desk__none">{{ text(TEXT.noRecord) }}</p>
                <ul v-else class="shelf-desk__pieces">
                    <li v-for="piece in recent" :key="piece.item.id" class="shelf-desk__piece">
                        <button type="button" class="shelf-desk__piece-button" :data-recent-piece="piece.item.id" @click="emit('continue', piece.item.id)">
                            <span class="shelf-desk__piece-head">
                                <span class="shelf-desk__piece-book">{{ projectDisplayName(piece.item) }}</span>
                                <span class="shelf-desk__piece-label">{{ piece.last.label }}</span>
                                <span class="shelf-desk__piece-when">{{ formatWhen(piece.last.at, now, locale) }}</span>
                            </span>
                            <span v-if="piece.last.excerpt !== ''" class="shelf-desk__piece-excerpt">{{ piece.last.excerpt }}</span>
                        </button>
                    </li>
                </ul>
            </div>
        </template>
        <NeuroBookMood state="idle" class="shelf-desk__mascot" />
        </div>
    </section>
</template>

<style scoped>
/* 案头不给面，直接压在窗体底纹上（设计语言“不给面”）。 */
.shelf-desk {
    container-type: inline-size;
}

.shelf-desk__grid {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) 150px;
    gap: var(--space-7);
    align-items: center;
    padding: var(--space-2) var(--space-2) 0;
}

.shelf-desk--empty .shelf-desk__grid {
    grid-template-columns: minmax(0, 1fr) 150px;
}

.shelf-desk__greeting {
    min-width: 0;
}

.shelf-desk__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: var(--weight-strong);
    line-height: 1.2;
}

.shelf-desk__lead {
    margin: var(--space-3) 0 0;
    max-width: 36em;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.8;
}

.shelf-desk__headline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
}

.shelf-desk__number {
    font-family: var(--font-display);
    font-size: 52px;
    font-weight: var(--weight-medium, 500);
    line-height: 1;
    letter-spacing: -0.01em;
    font-variation-settings: "opsz" 72;
}

.shelf-desk__unit {
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.shelf-desk__totals {
    margin: var(--space-3) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.shelf-desk__totals span + span::before {
    content: " · ";
    color: var(--text-muted);
}

.shelf-desk__continue {
    margin-top: var(--space-5);
}

.shelf-desk__eyebrow {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.18em;
}

.shelf-desk__none {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
}

.shelf-desk__pieces {
    margin: 0;
    padding: 0;
    list-style: none;
}

.shelf-desk__piece + .shelf-desk__piece {
    border-top: var(--border-w) solid var(--divider);
}

.shelf-desk__piece-button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    /* 悬停底色向两侧各出血一个案头内边距：文字和案头其它内容对齐，底色贴到案头边上，不越出去。 */
    width: calc(100% + 2 * var(--space-2));
    margin: 0 calc(-1 * var(--space-2));
    padding: var(--space-2) var(--space-2);
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.shelf-desk__piece-button:hover {
    background: color-mix(in srgb, var(--page-surface, var(--bg-panel)) 70%, transparent);
}

.shelf-desk__piece-button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.shelf-desk__piece-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    font-family: var(--font-display);
}

.shelf-desk__piece-book {
    font-size: 15px;
    font-weight: var(--weight-strong);
}

.shelf-desk__piece-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.shelf-desk__piece-when {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
}

.shelf-desk__piece-excerpt {
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.shelf-desk__mascot {
    justify-self: end;
    width: 150px;
    border-radius: 34px;
}

@container (max-width: 720px) {
    .shelf-desk__grid,
    .shelf-desk--empty .shelf-desk__grid {
        grid-template-columns: minmax(0, 1fr) 96px;
    }

    .shelf-desk__recent {
        grid-column: 1 / -1;
    }

    /* 窄时猫和统计并排在第一行，最近写到独占下一行；不定位的话自动摆放会把猫甩到最后一行。 */
    .shelf-desk__mascot {
        grid-row: 1;
        grid-column: 2;
        width: 96px;
        border-radius: 22px;
    }

    .shelf-desk__number {
        font-size: 40px;
    }
}
</style>
