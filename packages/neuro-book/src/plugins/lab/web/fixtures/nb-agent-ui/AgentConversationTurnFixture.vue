<script setup lang="ts">
/** 单独挂载一轮：消息与 ctx 来自场景输入，服务与注册表由夹具补齐（与 AgentConversationView 夹具一致）。 */
import {AgentConversationTurn} from "@notnotype/nb-agent-ui/vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {labAgentRegistry, labAgentServices, provideLabAgentHost} from "./host";

const props = defineProps<LabFixtureProps>();
provideLabAgentHost();
const subject = useLabSubject<typeof AgentConversationTurn>(() => props.input, ["action"]);
const registry = labAgentRegistry();
const services = labAgentServices();
</script>

<template>
    <AgentConversationTurn data-lab-subject class="w-full" v-bind="subject.bindings.value" :services="services" :registry="registry" />
</template>
