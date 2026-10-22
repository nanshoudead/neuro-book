<script setup lang="ts">
import {computed} from "vue";
import type {HostComponentEmits, ToolComponentProps} from "../../registry";
import {diffTaskLists, findPreviousTaskList, parseTaskList} from "../../task-list";
import {toolCallPhase} from "../../tool-status";
import {CollapsibleCard} from "@notnotype/nb-ui/components";
import AgentTaskList from "./AgentTaskList.vue";
import {useAgentText} from "../host";

const props = defineProps<ToolComponentProps>();
// 宿主组件的事件形状（`HostComponentEmits`）；内置的这个组件不发，声明出来免得 `@action` 落成根元素的原生监听。
defineEmits<HostComponentEmits>();

const {t} = useAgentText();

const list = computed(() => parseTaskList(props.call));
const changes = computed(() => {
    if (list.value === null || props.call.name === "task_create") {
        return null;
    }
    return diffTaskLists(findPreviousTaskList(props.ctx.messages, props.call.id), list.value);
});

const fallbackStatus = computed(() => {
    const phase = toolCallPhase(props.call.status);
    return phase === "done" ? "success" : phase;
});
</script>

<template>
    <AgentTaskList v-if="list" :title="list.title" :items="list.items" :changes="changes" />
    <CollapsibleCard v-else :running-label="t('turn.running')" icon="i-lucide-list-checks" :title="t('tool.task')" :status="fallbackStatus" />
</template>
