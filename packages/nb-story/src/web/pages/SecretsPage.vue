<script setup lang="ts">
/**
 * 秘密（docs/specs/story/viewer.md 输出 11）：秘密乘以人物（含读者）的矩阵。页顶是状态图例并写明“没有记录不等于
 * 不知道”；每行写读者在第几章知道；列头人名下写读者此时知道的化名；每格写状态、怎么知道的与出处。从别的页点进来时
 * （book.jump）滚到并高亮那一行。
 */
import {nextTick, onMounted, ref, watch} from "vue";

import type {Awareness} from "../../contract/contract";
import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";

const book = useBook();
const matrix = useStoryQuery("secrets.matrix", () => ({}));
const LEGEND: Awareness[] = ["knows", "read", "believes", "heard", "suspects", "unaware", "no-record"];
/** “怎么知道的”写得长的（整句描述）在格里只留前面一截，悬停看全文。 */
const HOW_LIMIT = 10;

const highlight = ref<string | null>(book.takeJump("secret"));
function chapterOf(ref: string): string {
    return ref.split(".")[0]!;
}
async function scrollToHighlight(): Promise<void> {
    if (highlight.value === null || !matrix.data.value) return;
    await nextTick();
    document.querySelector(`[data-secret="${CSS.escape(highlight.value)}"]`)?.scrollIntoView({block: "center"});
}
watch(() => matrix.data.value, () => void scrollToHighlight());
onMounted(() => void scrollToHighlight());
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-secrets">
        <div class="story-page-body">
            <h1 class="story-page-title">秘密 <span class="sub">谁知道什么，截至{{ book.atLabel.value }}<template v-if="matrix.data.value">，{{ matrix.data.value.rows.length }} 个秘密</template></span></h1>
            <div class="mb-2 flex flex-wrap items-center gap-1.5" data-testid="secrets-legend">
                <StateBadge v-for="state in LEGEND" :key="state" :state="state" />
                <span class="ml-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">“没有记录”不等于不知道：原文没写这个人对这件事的反应。</span>
            </div>
            <PageState :loading="matrix.loading.value && !matrix.data.value" :error="matrix.error.value?.message ?? null" @retry="matrix.reload()" />
            <p v-if="matrix.data.value && matrix.data.value.rows.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">到这里还没有秘密</p>
            <div v-if="matrix.data.value && matrix.data.value.rows.length" class="overflow-x-auto">
                <table class="story-table matrix" data-testid="secrets-matrix">
                    <thead>
                        <tr>
                            <th>秘密</th>
                            <th v-for="column in matrix.data.value.columns" :key="column.id" :data-column="column.id">
                                <NameLink v-if="column.id !== 'reader'" :id="column.id" :label="column.label" strong /><template v-else>{{ column.label }}</template>
                                <div v-if="column.aliases.length" class="alias" :title="column.aliases.join('、')">{{ column.aliases.join("、") }}</div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in matrix.data.value.rows" :key="row.id" :data-secret="row.id" :class="highlight === row.id ? 'is-highlight' : ''">
                            <td class="min-w-[200px]">
                                <div>{{ row.title }}</div>
                                <div class="text-[length:var(--text-2xs)] text-[var(--text-muted)]" data-testid="secret-revealed">{{ row.revealedAt ? `第 ${chapterOf(row.revealedAt)} 章读者知道` : "读者还不知道" }}</div>
                            </td>
                            <td v-for="cell in row.cells" :key="cell.column" :data-column="cell.column">
                                <div v-if="cell.state === 'no-record'" class="text-[var(--text-muted)]">·</div>
                                <div v-else class="flex flex-col items-start gap-0.5">
                                    <StateBadge :state="cell.state" />
                                    <span class="how">
                                        <span v-if="cell.how" :title="cell.how">{{ cell.how.length > HOW_LIMIT ? `${cell.how.slice(0, HOW_LIMIT)}…` : cell.how }}</span>
                                        <RefLink v-if="cell.ref" :ref-text="cell.ref" />
                                    </span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<style scoped>
.matrix th {
    vertical-align: bottom;
}
.matrix td {
    vertical-align: top;
}
.alias {
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    font-weight: normal;
    color: var(--text-muted);
}
.how {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0 4px;
    font-size: var(--text-2xs);
    color: var(--text-secondary);
}
tr.is-highlight td {
    background: var(--accent-bg);
}
</style>
