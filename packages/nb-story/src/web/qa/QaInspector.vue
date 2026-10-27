<script setup lang="ts">
import type {MessageView} from "@notnotype/nb-agent-ui";
import {Drawer} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {contextTokensOf, formatTokenCount} from "./models";
import {cacheBar, contextPercent, formatCost, formatPercent, sessionUsage} from "./usage";

const props = defineProps<{open: boolean; messages: readonly MessageView[]; contextLimit: number | null; currency: string | null}>();
const emit = defineEmits<{(event: "update:open", value: boolean): void}>();

const usage = computed(() => sessionUsage(props.messages));
const contextTokens = computed(() => contextTokensOf(props.messages));
const percent = computed(() => contextPercent(contextTokens.value, props.contextLimit));
const rows = computed(() => usage.value.requests.map(request => ({request, bar: cacheBar(request)})));
const money = (value: number | null) => (value === null || props.currency === null ? "—" : formatCost(value, props.currency));
</script>

<template>
    <Drawer :open="open" direction="right" title="上下文与缓存" description="这个对话里每次模型请求的用量" content-class="w-[460px]" @update:open="value => emit('update:open', value)">
        <div class="qa-inspector" data-testid="qa-inspector">
            <section>
                <h3>上下文</h3>
                <p class="qa-inspector-line">最近一次请求的提示词 <b>{{ formatTokenCount(contextTokens) }}</b><template v-if="contextLimit"> / 窗口 {{ formatTokenCount(contextLimit) }}</template><template v-if="percent !== null">（{{ formatPercent(percent) }}）</template></p>
                <div v-if="percent !== null" class="qa-inspector-gauge" role="progressbar" :aria-valuenow="Math.min(100, Math.round(percent))" aria-valuemin="0" aria-valuemax="100"><i :style="{width: `${Math.min(100, percent)}%`}" /></div>
            </section>

            <section>
                <h3>累积</h3>
                <dl class="qa-inspector-totals">
                    <div><dt>请求</dt><dd>{{ usage.requests.length }} 次</dd></div>
                    <div><dt>输入</dt><dd>{{ formatTokenCount(usage.input) }}</dd></div>
                    <div><dt>缓存读</dt><dd>{{ formatTokenCount(usage.cacheRead) }}</dd></div>
                    <div><dt>缓存写</dt><dd>{{ formatTokenCount(usage.cacheWrite) }}</dd></div>
                    <div><dt>输出</dt><dd>{{ formatTokenCount(usage.output) }}</dd></div>
                    <div><dt>命中率</dt><dd>{{ usage.hitRate === null ? "—" : formatPercent(usage.hitRate * 100) }}</dd></div>
                    <div v-if="usage.cost !== null"><dt>费用</dt><dd v-if="currency === null">用过不同币种的模型，不合计</dd><dd v-else>{{ usage.costComplete ? "" : "≥" }}{{ money(usage.cost) }}<template v-if="!usage.costComplete">（有请求不知道单价）</template></dd></div>
                </dl>
            </section>

            <section>
                <h3>每次请求的缓存</h3>
                <p class="qa-inspector-legend"><span class="read" />缓存读 <span class="write" />缓存写 <span class="fresh" />新输入</p>
                <ol class="qa-inspector-rows">
                    <li v-for="row in rows" :key="row.request.index" data-testid="qa-request">
                        <span class="qa-inspector-no">#{{ row.request.index }}</span>
                        <span class="qa-inspector-bar" :title="`提示词 ${row.request.prompt}`"><i class="read" :style="{width: `${row.bar.read}%`}" /><i class="write" :style="{width: `${row.bar.write}%`}" /><i class="fresh" :style="{width: `${row.bar.fresh}%`}" /></span>
                        <span class="qa-inspector-rate">{{ row.request.hitRate === null ? "—" : formatPercent(row.request.hitRate * 100) }}</span>
                        <span class="qa-inspector-tokens">{{ formatTokenCount(row.request.prompt) }} → {{ formatTokenCount(row.request.output) }}</span>
                        <span v-if="row.request.cost !== null" class="qa-inspector-cost">{{ money(row.request.cost) }}</span>
                    </li>
                </ol>
            </section>
        </div>
    </Drawer>
</template>

<style scoped>
.qa-inspector { display: flex; flex-direction: column; gap: 20px; font-size: var(--text-sm); }
.qa-inspector h3 { margin: 0 0 6px; font-size: var(--text-sm); font-weight: var(--weight-strong); color: var(--text-secondary); }
.qa-inspector-line { margin: 0 0 6px; }
.qa-inspector-gauge { height: 8px; border-radius: 4px; background: var(--bg-subtle); overflow: hidden; }
.qa-inspector-gauge i { display: block; height: 100%; background: var(--accent-main); }
.qa-inspector-totals { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 0; }
.qa-inspector-totals div { display: flex; flex-direction: column; padding: 6px 8px; border-radius: 8px; background: var(--bg-subtle); }
.qa-inspector-totals dt { color: var(--text-muted); font-size: var(--text-2xs); }
.qa-inspector-totals dd { margin: 0; font-weight: var(--weight-strong); }
.qa-inspector-legend { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; color: var(--text-muted); font-size: var(--text-2xs); }
.qa-inspector-legend span { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.read { background: var(--status-success); } .write { background: var(--status-warning); } .fresh { background: var(--text-muted); opacity: 0.5; }
.qa-inspector-rows { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.qa-inspector-rows li { display: grid; grid-template-columns: 2.4rem 1fr 3rem; gap: 4px 8px; align-items: center; }
.qa-inspector-no { color: var(--text-muted); }
.qa-inspector-bar { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: var(--bg-subtle); }
.qa-inspector-bar i { display: block; height: 100%; }
.qa-inspector-rate { text-align: right; }
.qa-inspector-tokens, .qa-inspector-cost { grid-column: 2 / 4; color: var(--text-muted); font-size: var(--text-2xs); }
</style>
