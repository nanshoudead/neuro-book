<script setup lang="ts">
import {onErrorCaptured, ref} from "vue";
import {CollapsibleCard} from "@notnotype/nb-ui/components";

import {useAgentText} from "../host";

/**
 * 宿主或插件登记的组件（工具详情、节点）渲染时抛错，只有这一项换成“此内容无法显示”，视图其余部分照常
 * （docs/specs/ui/agent-conversation-view.md“失败与恢复”）。错误打一条开发诊断，不再往上抛。
 */
const props = defineProps<{
    /** 出错时诊断里写的来源，例如渲染器 id。 */
    source: string;
}>();

const {t} = useAgentText();
const failed = ref(false);

onErrorCaptured((error) => {
    failed.value = true;
    console.error(`nb-agent-ui: ${props.source} 渲染时抛错，这一项不显示`, error);
    return false;
});
</script>

<template>
    <CollapsibleCard v-if="failed" icon="i-lucide-circle-alert" :title="t('render.failed')" status="error" data-render-failed />
    <slot v-else />
</template>
