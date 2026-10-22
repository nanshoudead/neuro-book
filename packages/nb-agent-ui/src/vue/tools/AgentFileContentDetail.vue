<script setup lang="ts">
import {computed} from "vue";
import type {ToolDetailProps} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {argString} from "../../tool-args";
import {fileContentLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolDetailProps>();

const {t} = useAgentText();

const content = computed(() => fileContentLines(props.call));
</script>

<template>
    <CodeBlock
        v-if="props.call.result"
        :empty-text="t('toolDetail.empty')"
        :truncated-text="t('toolDetail.truncated')"
        :label="argString(props.call, 'path')"
        :lines="content.lines"
        :start-line="content.startLine"
        :truncated="props.call.result.truncated"
    />
    <p v-else-if="!props.call.error" class="agent-file-content-detail__pending">{{ t("toolDetail.pending") }}</p>
</template>

<style scoped>
.agent-file-content-detail__pending {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
