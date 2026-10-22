<script setup lang="ts">
/** nb-ui 的 `CodeBlock`，带上本包的“内容为空”“只公开了部分内容”两条文字；工具详情与原始视图都用它。 */
import {CodeBlock} from "@notnotype/nb-ui/components";
import type {CodeLine} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = withDefaults(defineProps<{
    lines: CodeLine[];
    label?: string;
    startLine?: number | null;
    truncated?: boolean;
}>(), {
    label: "",
    startLine: null,
    truncated: false,
});

const {t} = useAgentText();
</script>

<template>
    <CodeBlock
        :lines="props.lines"
        :label="props.label"
        :start-line="props.startLine"
        :truncated="props.truncated"
        :empty-text="t('toolDetail.empty')"
        :truncated-text="t('toolDetail.truncated')"
    />
</template>
