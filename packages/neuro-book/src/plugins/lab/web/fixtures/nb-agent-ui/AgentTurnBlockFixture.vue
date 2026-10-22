<script setup lang="ts">
/** 单独挂载一个轮次块：块与 ctx 来自场景输入，服务与注册表由夹具补齐（与 AgentConversationView 夹具一致）。 */
import {AgentTurnBlock} from "@notnotype/nb-agent-ui/vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {labAgentRegistry, labAgentServices, provideLabAgentHost} from "./host";

const props = defineProps<LabFixtureProps>();
provideLabAgentHost();
const subject = useLabSubject<typeof AgentTurnBlock>(() => props.input, ["action"]);
const registry = labAgentRegistry();
const services = labAgentServices();
</script>

<template>
    <!-- 不加 w-full：块自带 24px 左缩进，再占满宽度就会横向溢出。 -->
    <AgentTurnBlock data-lab-subject v-bind="subject.bindings.value" :services="services" :registry="registry" />
</template>
