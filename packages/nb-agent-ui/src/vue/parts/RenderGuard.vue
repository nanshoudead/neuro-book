<script setup lang="ts">
import {onErrorCaptured, ref} from "vue";
import {CollapsibleCard} from "@notnotype/nb-ui/components";

import {useAgentText} from "../host";

/**
 * 宿主或插件登记的组件（工具详情、节点、附注）渲染时抛错，只有这一项换成“此内容无法显示”，视图其余部分照常
 * （docs/specs/ui/agent-conversation-view.md“失败与恢复”）。错误打一条开发诊断，不再往上抛。给了 `fallback` 插槽时
 * 显示它（附注退回它自己的那一句），不画错误卡片。出错一次就不再重试，数据变了也一样。
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
    <template v-if="failed">
        <slot name="fallback">
            <CollapsibleCard icon="i-lucide-circle-alert" :title="t('render.failed')" status="error" data-render-failed />
        </slot>
    </template>
    <slot v-else />
</template>
