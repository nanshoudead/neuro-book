<script setup lang="ts">
import {computed} from "vue";
import type {HostComponentEmits, ToolComponentProps} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {argString} from "../../tool-args";
import {fileContentLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolComponentProps>();
// 宿主组件的事件形状（`HostComponentEmits`）；内置的这个组件不发，声明出来免得 `@action` 落成根元素的原生监听。
defineEmits<HostComponentEmits>();


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
