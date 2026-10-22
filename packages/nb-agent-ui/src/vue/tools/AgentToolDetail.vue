<script setup lang="ts">
import {computed} from "vue";
import type {AgentConversationContext, ToolCallView} from "../../types";
import type {AgentViewRegistry} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {jsonLines, textLines} from "../../tool-detail-lines";
import RenderGuard from "../parts/RenderGuard.vue";
import {useAgentText} from "../host";

const props = defineProps<{
    call: ToolCallView;
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
}>();

const {t} = useAgentText();

const adapter = computed(() => props.registry.resolveTool(props.call.name).detail ?? null);
</script>

<template>
    <div class="agent-tool-detail">
        <p v-if="props.call.error" class="agent-tool-detail__error">{{ props.call.error }}</p>
        <!-- 出错且没有结果时，适配组件没东西可画，附上原始参数以便看是什么参数导致的 -->
        <CodeBlock
            v-if="adapter && props.call.error && !props.call.result"
            :empty-text="t('toolDetail.empty')"
            :truncated-text="t('toolDetail.truncated')"
            :label="t('toolDetail.args', {name: props.call.name})"
            :lines="jsonLines(props.call.args)"
        />
        <RenderGuard v-else-if="adapter" :source="`工具 ${props.call.name} 的详情组件`">
            <component :is="adapter" :call="props.call" :ctx="props.ctx" />
        </RenderGuard>
        <!-- 没有适配的工具：原样显示参数与结果 -->
        <template v-else>
            <CodeBlock :empty-text="t('toolDetail.empty')" :truncated-text="t('toolDetail.truncated')" :label="t('toolDetail.args', {name: props.call.name})" :lines="jsonLines(props.call.args)" />
            <CodeBlock
                v-if="props.call.result"
                :empty-text="t('toolDetail.empty')"
                :truncated-text="t('toolDetail.truncated')"
                :label="t('toolDetail.result')"
                :lines="textLines(props.call.result.text)"
                :truncated="props.call.result.truncated"
            />
            <CodeBlock
                v-if="props.call.result?.details !== undefined"
                :empty-text="t('toolDetail.empty')"
                :truncated-text="t('toolDetail.truncated')"
                :label="t('toolDetail.details')"
                :lines="jsonLines(props.call.result.details)"
            />
            <p v-if="!props.call.result && !props.call.error" class="agent-tool-detail__pending">{{ t("toolDetail.pending") }}</p>
        </template>
    </div>
</template>

<style scoped>
.agent-tool-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 2px 0 4px;
}

.agent-tool-detail__error {
    color: var(--status-danger);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.agent-tool-detail__pending {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
