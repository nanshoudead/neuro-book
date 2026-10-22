<script setup lang="ts">
import {computed} from "vue";
import type {ToolDetailProps} from "../../registry";
import {CodeBlock} from "@notnotype/nb-ui/components";
import {argString, parsePatchChanges} from "../../tool-args";
import {fileDiffLines} from "../../tool-detail-lines";
import {useAgentText} from "../host";

const props = defineProps<ToolDetailProps>();

const {t} = useAgentText();

const label = computed(() => props.call.name === "apply_patch"
    ? parsePatchChanges(argString(props.call, "patch")).map((change) => change.path).join(", ")
    : argString(props.call, "path"));
const lines = computed(() => fileDiffLines(props.call));
</script>

<template>
    <CodeBlock :empty-text="t('toolDetail.empty')" :truncated-text="t('toolDetail.truncated')" :label="label" :lines="lines" />
</template>
