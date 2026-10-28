<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";

import {OP_WORDS, SOURCE_WORDS, type RevisionItem} from "../host/revise";
import RefLink from "./RefLink.vue";

defineProps<{item: RevisionItem; busy?: boolean; highlighted?: boolean}>();
defineEmits<{confirm: [item: RevisionItem]; reject: [item: RevisionItem]; undo: [item: RevisionItem]; open: [item: RevisionItem]}>();

const STATE_WORDS = {pending: "待确认", adopted: "已采纳", rejected: "已驳回", closed: "后文已确认", stale: "对不上，已不套用", withdrawn: "已撤销"} as const;
const STATE_TONE = {pending: "accent", adopted: "success", rejected: "neutral", closed: "accent", stale: "warning", withdrawn: "neutral"} as const;
</script>

<template>
    <article class="revision-card" :class="{'is-highlighted': highlighted, 'is-done': item.state !== 'pending' && item.state !== 'stale'}" :data-revision="item.id" :data-state="item.state" @click="$emit('open', item)">
        <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant="soft" :tone="item.source === 'persona-check' ? 'accent' : item.source === 'user' ? 'success' : 'warning'">{{ SOURCE_WORDS[item.source] }}</Badge>
                <Badge v-if="item.state !== 'pending'" size="sm" variant="soft" :tone="STATE_TONE[item.state]" data-testid="revision-state">{{ STATE_WORDS[item.state] }}</Badge>
                <b class="min-w-0 text-[length:var(--text-sm)]" data-testid="revision-summary">{{ item.summary }}</b>
            </div>
            <p class="mt-0.5 text-[length:var(--text-xs)] text-[var(--accent-text)]">{{ OP_WORDS[item.op] }}</p>
            <blockquote v-if="item.quote" class="quote"><RefLink :ref-text="item.evidence" class="mr-1.5" />{{ item.quote }}</blockquote>
        </div>
        <div class="flex shrink-0 flex-col items-stretch gap-1" @click.stop>
            <template v-if="item.state === 'pending'">
                <Button size="sm" :disabled="busy" data-testid="revision-confirm" @click="$emit('confirm', item)">确认是同一人</Button>
                <Button size="sm" variant="ghost" :disabled="busy" data-testid="revision-reject" @click="$emit('reject', item)">驳回</Button>
            </template>
            <Button v-else-if="item.state === 'stale'" size="sm" variant="ghost" :disabled="busy" data-testid="revision-discard" @click="$emit('undo', item)">丢弃</Button>
            <Button v-else-if="item.undoable" size="sm" variant="ghost" icon-class="i-lucide-undo-2" :disabled="busy" data-testid="revision-undo" @click="$emit('undo', item)">撤销</Button>
        </div>
    </article>
</template>

<style scoped>
.revision-card {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-card, 12px);
    background: var(--bg-panel);
    cursor: pointer;
}
.revision-card.is-done {
    background: transparent;
}
.revision-card.is-highlighted {
    border-color: var(--border-accent);
    background: var(--accent-bg);
}
.quote {
    margin: 4px 0 0;
    padding: 2px 10px;
    border-left: 3px solid var(--border-accent);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: 1.6;
}
</style>
