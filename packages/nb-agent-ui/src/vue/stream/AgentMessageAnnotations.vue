<script setup lang="ts">
/**
 * 一条助手消息上的附注（Spec“术语”的附注）：登记了条目渲染器的由宿主组件画，没登记或组件出错时画默认的淡色一行。
 * 最终回复的气泡、思维链里的中间 content 与单独成行的附注块三处共用。
 */
import {computed} from "vue";
import type {AgentConversationContext, AgentConversationServices, AssistantMessageView} from "../../types";
import type {AgentViewRegistry} from "../../registry";
import RenderGuard from "../parts/RenderGuard.vue";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    message: AssistantMessageView;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {locale} = useAgentText();
const items = computed(() => (props.message.annotations ?? []).map((annotation, index) => ({
    key: `${annotation.customType}:${index}`,
    annotation,
    entry: props.registry.resolveEntry(annotation.customType),
})));
</script>

<template>
    <div v-if="items.length > 0" class="acv-annotations">
        <template v-for="{key, annotation, entry} in items" :key="key">
            <RenderGuard v-if="entry" :source="`条目 ${entry.id} 的组件`">
                <component
                    :is="entry.component"
                    :annotation="annotation"
                    :message="props.message"
                    :ctx="props.ctx"
                    :services="props.services"
                    :locale="locale"
                    :data-annotation="annotation.customType"
                    @action="emit('action', $event)"
                />
                <template #fallback>
                    <p class="acv-annotation" :data-annotation="annotation.customType">{{ annotation.text }}</p>
                </template>
            </RenderGuard>
            <p v-else class="acv-annotation" :data-annotation="annotation.customType">{{ annotation.text }}</p>
        </template>
    </div>
</template>

<style scoped>
.acv-annotations {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
}

.acv-annotation {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.65;
}
</style>
