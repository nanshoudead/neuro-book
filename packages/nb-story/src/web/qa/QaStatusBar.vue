<script setup lang="ts">
import type {MessageView} from "@notnotype/nb-agent-ui";
import {computed} from "vue";

import {contextTokensOf, formatTokenCount} from "./models";
import {contextPercent, formatCost, formatPercent, sessionUsage} from "./usage";

const props = defineProps<{messages: readonly MessageView[]; contextLimit: number | null; currency: "USD" | "CNY"}>();
const emit = defineEmits<{(event: "open"): void}>();

const usage = computed(() => sessionUsage(props.messages));
const context = computed(() => {
    const tokens = contextTokensOf(props.messages);
    const percent = contextPercent(tokens, props.contextLimit);
    return {tokens, percent};
});
</script>

<template>
    <button v-if="usage.requests.length > 0" type="button" class="qa-status" data-testid="qa-status" aria-label="打开上下文检查器" title="点开看上下文与缓存的详情" @click="emit('open')">
        <span class="qa-status-chip" data-stat="context">上下文 <b>{{ formatTokenCount(context.tokens) }}</b><template v-if="contextLimit"> / {{ formatTokenCount(contextLimit) }}</template><template v-if="context.percent !== null"> · {{ formatPercent(context.percent) }}</template></span>
        <span class="qa-status-chip" data-stat="input">输入 <b>{{ formatTokenCount(usage.input + usage.cacheRead + usage.cacheWrite) }}</b></span>
        <span class="qa-status-chip" data-stat="output">输出 <b>{{ formatTokenCount(usage.output) }}</b></span>
        <span class="qa-status-chip" data-stat="cache">缓存读 <b>{{ formatTokenCount(usage.cacheRead) }}</b><template v-if="usage.hitRate !== null"> · 命中 <b>{{ formatPercent(usage.hitRate * 100) }}</b></template></span>
        <span v-if="usage.cost !== null" class="qa-status-chip" data-stat="cost"><b>{{ formatCost(usage.cost, currency) }}</b></span>
        <span class="qa-status-more i-lucide-panel-right-open" aria-hidden="true" />
    </button>
</template>

<style scoped>
.qa-status { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; width: 100%; padding: 4px 16px; border-top: 1px solid var(--divider); background: var(--panel-surface); color: var(--text-secondary); font-size: var(--text-2xs); text-align: left; cursor: pointer; }
.qa-status:hover { background: var(--bg-hover); }
.qa-status-chip { display: inline-flex; gap: 4px; align-items: baseline; border-radius: 999px; background: var(--bg-subtle); padding: 1px 8px; white-space: nowrap; }
.qa-status-chip b { color: var(--text-main); font-weight: var(--weight-strong); }
.qa-status-more { margin-left: auto; color: var(--text-muted); }
</style>
