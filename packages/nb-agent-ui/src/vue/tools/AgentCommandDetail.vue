<script setup lang="ts">
import type {HostComponentEmits, ToolComponentProps} from "../../registry";
import AgentCodeBlock from "../parts/AgentCodeBlock.vue";
import {commandText, textLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolComponentProps>();
// 宿主组件的事件形状（`HostComponentEmits`）；内置的这个组件不发，声明出来免得 `@action` 落成根元素的原生监听。
defineEmits<HostComponentEmits>();


const {t} = useAgentText();
</script>

<template>
    <div class="agent-command-detail">
        <AgentCodeBlock :label="t('toolDetail.command')" :lines="textLines(commandText(props.call))" />
        <AgentCodeBlock
            v-if="props.call.result"
            :label="t('toolDetail.output')"
            :lines="textLines(props.call.result.text)"
            :truncated="props.call.result.truncated"
        />
        <p v-else-if="!props.call.error" class="agent-command-detail__pending">{{ t("toolDetail.pending") }}</p>
    </div>
</template>

<style scoped>
.agent-command-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.agent-command-detail__pending {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
