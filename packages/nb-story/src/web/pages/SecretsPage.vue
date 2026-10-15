<script setup lang="ts">
/**
 * 秘密（docs/specs/story/viewer.md 输出 11）：秘密乘以人物（含读者）的矩阵，每格写状态与出处，点出处看原文；
 * 图例写明“没有记录不等于不知道”。
 */
import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";

const book = useBook();
const matrix = useStoryQuery("secrets.matrix", () => ({}));
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-secrets">
        <div class="story-page-body">
            <h1 class="story-page-title">秘密 <span class="sub">谁知道什么，截至{{ book.atLabel.value }}</span></h1>
            <p class="mb-2 text-[var(--text-xs)] text-[var(--text-muted)]">每格是这个人到阅读位置为止最新的状态。“没有记录”不等于不知道：原文没有写他知不知道。</p>
            <PageState :loading="matrix.loading.value && !matrix.data.value" :error="matrix.error.value?.message ?? null" @retry="matrix.reload()" />
            <p v-if="matrix.data.value && matrix.data.value.rows.length === 0" class="text-[var(--text-sm)] text-[var(--text-muted)]">到这里还没有秘密</p>
            <div v-if="matrix.data.value && matrix.data.value.rows.length" class="overflow-x-auto">
                <table class="story-table" data-testid="secrets-matrix">
                    <thead>
                        <tr><th>秘密</th><th v-for="column in matrix.data.value.columns" :key="column.id">{{ column.label }}</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in matrix.data.value.rows" :key="row.id" :data-secret="row.id">
                            <td class="min-w-[180px]">{{ row.title }}</td>
                            <td v-for="cell in row.cells" :key="cell.column" :data-column="cell.column">
                                <div class="flex flex-col items-start gap-0.5"><StateBadge :state="cell.state" /><RefLink v-if="cell.ref" :ref-text="cell.ref" /></div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
