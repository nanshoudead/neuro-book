<script setup lang="ts">
import type {ToolDetailProps} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {commandText, textLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolDetailProps>();

const {t} = useAgentText();
</script>

<template>
    <div class="agent-command-detail">
        <CodeBlock :empty-text="t('toolDetail.empty')" :truncated-text="t('toolDetail.truncated')" :label="t('toolDetail.command')" :lines="textLines(commandText(props.call))" />
        <CodeBlock
            v-if="props.call.result"
            :empty-text="t('toolDetail.empty')"
            :truncated-text="t('toolDetail.truncated')"
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
