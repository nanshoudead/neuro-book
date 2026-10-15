<script setup lang="ts">
/**
 * 顶栏的全局搜索（docs/specs/story/viewer.md 输出 1、18）：按停止输入后的文字搜对象、说法、原文，结果浮在输入框下面；
 * 点对象打开人物卡，点说法或原文打开出处原文。窄宽度下收成按钮，点了再展开输入框。
 */
import {FormInput, IconButton} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery} from "../host/query";

defineProps<{compact?: boolean}>();
const book = useBook();
/** 停止输入多久后才搜。 */
const DEBOUNCE_MS = 250;

const text = ref("");
const query = ref("");
const open = ref(false);
const expanded = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(text, value => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
        query.value = value.trim();
        open.value = query.value !== "";
    }, DEBOUNCE_MS);
});
// 点搜索框与结果面板之外的地方关掉面板。
const root = ref<HTMLElement | null>(null);
function onPointer(event: PointerEvent): void {
    if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}
document.addEventListener("pointerdown", onPointer);
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    document.removeEventListener("pointerdown", onPointer);
});

const results = usePagedQuery("search", () => (query.value ? {query: query.value} : null), 50);
const KIND = {entity: "对象", statement: "说法", source: "原文"} as const;
const grouped = computed(() => {
    const groups: {kind: keyof typeof KIND; items: typeof results.items.value}[] = [];
    for (const item of results.items.value) {
        const last = groups.at(-1);
        if (last?.kind === item.kind) last.items.push(item);
        else groups.push({kind: item.kind, items: [item]});
    }
    return groups;
});

function choose(item: (typeof results.items.value)[number]): void {
    if (item.kind === "entity" && item.id) book.openCard(item.id);
    else book.openSource(item.ref);
    open.value = false;
}
function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") open.value = false;
}
</script>

<template>
    <div ref="root" class="search-box relative" @keydown="onKey">
        <IconButton v-if="compact && !expanded" size="sm" icon-class="i-lucide-search" aria-label="搜索" @click="expanded = true" />
        <div v-else :class="compact ? 'w-[200px]' : 'w-[280px]'">
            <FormInput v-model="text" size="sm" icon-class="i-lucide-search" placeholder="搜人物、称呼、说法、原文" aria-label="搜索" data-testid="search-input" @focus="open = query !== ''" />
        </div>
        <div v-if="open" class="search-results absolute overflow-y-auto right-0 top-full z-40 mt-1 max-h-[60vh] w-[360px] max-w-[90vw] rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-panel)] p-2 shadow-[var(--shadow-panel)]" data-testid="search-results">
            <p class="pb-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                <template v-if="results.total.value !== null">共 {{ results.total.value }} 条（截至{{ book.atLabel.value }}）</template>
                <template v-else-if="results.loading.value">正在搜……</template>
            </p>
            <p v-if="results.error.value" class="text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ results.error.value.message }}</p>
            <section v-for="group in grouped" :key="group.kind" class="mb-2">
                <h3 class="text-[length:var(--text-xs)] font-[var(--weight-strong)] text-[var(--text-secondary)]">{{ KIND[group.kind] }}</h3>
                <button v-for="(item, index) in group.items" :key="index" type="button" class="search-item block w-full rounded px-1 py-0.5 text-left text-[length:var(--text-sm)]" @click="choose(item)">
                    <span class="mr-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.ref }}</span>{{ item.text }}
                </button>
            </section>
            <button v-if="results.hasMore.value" type="button" class="text-[length:var(--text-xs)] text-[var(--accent-text)]" @click="results.more()">再取 50 条</button>
            <div class="mt-1 text-right"><button type="button" class="text-[length:var(--text-xs)] text-[var(--text-muted)]" @click="open = false">关闭</button></div>
        </div>
    </div>
</template>

<style scoped>
.search-item:hover {
    background: var(--bg-hover);
}
</style>
