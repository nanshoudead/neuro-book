<script setup lang="ts">
import {computed} from "vue";
import type {ToolDetailProps} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {argString, editInputChanges, parsePatchChanges} from "../../tool-args";
import {fileDiffLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolDetailProps>();

const {t} = useAgentText();

const label = computed(() => {
    if (props.call.name === "apply_patch") return parsePatchChanges(argString(props.call, "patch")).map((change) => change.path).join(", ");
    return argString(props.call, "path") || editInputChanges(props.call).map((change) => change.path).join(", ");
});
const lines = computed(() => fileDiffLines(props.call));
</script>

<template>
    <CodeBlock :empty-text="t('toolDetail.empty')" :truncated-text="t('toolDetail.truncated')" :label="label" :lines="lines" />
</template>
