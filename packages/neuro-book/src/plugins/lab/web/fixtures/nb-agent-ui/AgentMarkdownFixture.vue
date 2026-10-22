<script setup lang="ts">
/** 回复正文：注入 `nbook.markdown` 的 MarkdownDisplay；场景“缺省实现”不注入，看纯文字的样子。 */
import {AgentMarkdown} from "@notnotype/nb-agent-ui/vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {labAgentServices, provideLabAgentHost} from "./host";

const props = defineProps<LabFixtureProps>();
provideLabAgentHost({plain: props.scene === "plain"});
const subject = useLabSubject<typeof AgentMarkdown>(() => props.input, ["action", "preview-image"]);
const services = labAgentServices();
</script>

<template>
    <AgentMarkdown data-lab-subject class="w-full" v-bind="subject.bindings.value" :services="services" />
</template>
