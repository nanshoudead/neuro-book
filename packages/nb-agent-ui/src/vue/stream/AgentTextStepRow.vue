<script setup lang="ts">
/** 思维链里的一段文字步骤：思考或系统提示词。折叠时露出第一行，展开是淡色小字的 Markdown 全文。展开状态由使用方按 id 记。 */
import {CollapsibleRow} from "@notnotype/nb-ui/components";
import type {AgentConversationServices} from "../../types";
import {firstLine} from "../../format";
import AgentMarkdown from "../parts/AgentMarkdown.vue";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    icon: string;
    label: string;
    text: string;
    services: AgentConversationServices;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
    (e: "update:expanded", expanded: boolean): void;
}>();

const {t} = useAgentText();
</script>

<template>
    <CollapsibleRow
        :running-label="t('turn.running')"
        :icon="props.icon"
        :label="props.label"
        :detail="props.expanded ? '' : firstLine(props.text)"
        :expanded="props.text.trim() === '' ? undefined : props.expanded"
        @update:expanded="emit('update:expanded', $event)"
    >
        <AgentMarkdown class="acv-thinking" :text="props.text" :resolve-asset="props.services.resolveMarkdownAsset" @action="emit('action', $event)" />
    </CollapsibleRow>
</template>

<style scoped>
.acv-thinking {
    padding: 2px 8px 4px 0;
    --nb-agent-markdown-color: var(--text-muted);
    --nb-agent-markdown-size: var(--text-xs);
}
</style>
