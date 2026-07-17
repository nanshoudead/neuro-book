<script setup lang="ts">
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import AgentToolNode from "nbook/app/components/novel-ide/agent/AgentToolNode.vue";
import AgentAttachmentGallery from "nbook/app/components/novel-ide/agent/AgentAttachmentGallery.vue";
import {resolveToolRenderConfig} from "nbook/app/components/novel-ide/agent/tool-render-registry";
import { useCollapsible } from "nbook/app/composables/useCollapsible";

const props = defineProps<{
    toolCall: AgentToolCall;
    /** 当前 durable session；live tool result 尚无 entry locator 时不会请求附件。 */
    sessionId?: number | null;
}>();

const emit = defineEmits<{
    (e: "copy", toolCall: AgentToolCall): void;
}>();

const { isCollapsed, toggle } = useCollapsible(true);

const renderConfig = computed(() => resolveToolRenderConfig(props.toolCall));
const resultAttachments = computed(() => (props.toolCall.publicResult?.content ?? [])
    .flatMap((item) => item.type === "attachment" && typeof item.contentIndex === "number"
        ? [{contentIndex: item.contentIndex, attachment: item.attachment}]
        : []));
</script>

<template>
    <div v-if="renderConfig.mode === 'message' && renderConfig.component" class="group flex min-w-0 w-full flex-col items-stretch pl-6">
        <component :is="renderConfig.component" :tool-call="props.toolCall" />
        <AgentAttachmentGallery
            v-if="props.toolCall.resultEntryId && resultAttachments.length > 0"
            :attachments="resultAttachments"
            :session-id="props.sessionId"
            :entry-id="props.toolCall.resultEntryId"
        />
    </div>
    <div v-else class="group flex min-w-0 w-full flex-col items-start pl-6">
        <AgentToolNode
            :tool-call="props.toolCall"
            :expanded="!isCollapsed"
            @toggle="toggle"
            @copy="emit('copy', props.toolCall)"
        />
        <AgentAttachmentGallery
            v-if="props.toolCall.resultEntryId && resultAttachments.length > 0"
            class="w-full"
            :attachments="resultAttachments"
            :session-id="props.sessionId"
            :entry-id="props.toolCall.resultEntryId"
        />
    </div>
</template>
