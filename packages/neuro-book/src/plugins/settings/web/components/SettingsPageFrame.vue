<script setup lang="ts">
/** page 分区的可见形态（同名 .md）：交付状态、加载、两种失败与错误边界；加载与代际由窗口模型决定。 */
import {Button, Spinner} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, defineComponent, onErrorCaptured} from "vue";
import type {Component, PropType} from "vue";

import {settingsText} from "../../shared/text";
import type {SettingsTextKey} from "../../shared/text";
import type {SettingsPageContext} from "../contracts";
import type {SettingsPageDelivery} from "../sections";
import type {SettingsPageStatus} from "../settings-window";

defineOptions({name: "SettingsPageFrame"});

const props = withDefaults(defineProps<{
    delivery: SettingsPageDelivery;
    status: SettingsPageStatus;
    error: string | null;
    component: Component | null;
    context: SettingsPageContext;
    generation: number;
    busy?: boolean;
}>(), {busy: false});

const emit = defineEmits<{
    (event: "retry-entry"): void;
    (event: "reload"): void;
    (event: "retry-render"): void;
    (event: "render-error", generation: number, message: string): void;
}>();

/** 加载与失败的说明在 `nbook.settings` 的目录里，经宿主注入的翻译端口翻译；`reason` 是失败那一刻的原因（服务端或插件给的原文）。 */
const port = useText();
const text = (key: SettingsTextKey, reason = ""): string => port.t(settingsText(key, {reason}));

const state = computed(() => (props.delivery.kind === "available" ? props.status : props.delivery.kind));
const loading = computed(() => props.delivery.kind === "declared" || (props.delivery.kind === "available" && (props.status === "waiting" || props.status === "loading")));
const failed = computed(() => ["entry-blocked", "entry-failed", "entry-stopped", "entry-not-activatable"].includes(props.delivery.kind) || (props.delivery.kind === "available" && (props.status === "load-failed" || props.status === "render-failed")));

/** 错误边界：接住子树在 Vue 调用路径上的错误并报给模型，不再往上冒。外框以代际作 key 重建它，新实例从头开始。 */
const ErrorBoundary = defineComponent({
    name: "SettingsPageErrorBoundary",
    props: {generation: {type: Number, required: true}, onFailed: {type: Function as PropType<(generation: number, message: string) => void>, required: true}},
    setup(boundaryProps, {slots}) {
        onErrorCaptured((error) => {
            boundaryProps.onFailed(boundaryProps.generation, error instanceof Error ? error.message : String(error));
            return false;
        });
        return () => slots.default?.();
    },
});

function reportRenderError(generation: number, message: string): void {
    emit("render-error", generation, message);
}
</script>

<template>
    <div class="settings-page-frame" :data-settings-page="context.id" :data-settings-page-state="state">
        <ErrorBoundary v-if="state === 'ready' && component !== null" :key="generation" :generation="generation" :on-failed="reportRenderError">
            <component :is="component" :context="context" />
        </ErrorBoundary>
        <div v-else-if="loading" class="settings-page-frame__notice" role="status" aria-live="polite" aria-busy="true">
            <Spinner size="sm" />
            <span>{{ text(delivery.kind === 'declared' ? 'pageFrame.declared' : 'pageFrame.loading') }}</span>
        </div>
        <div v-else-if="failed" class="settings-page-frame__notice" role="alert">
            <template v-if="delivery.kind === 'entry-blocked'">{{ text('pageFrame.blocked', delivery.reason) }}</template>
            <template v-else-if="delivery.kind === 'entry-failed'">
                <span>{{ text('pageFrame.failed', delivery.reason) }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-retry-entry @click="emit('retry-entry')">{{ text('pageFrame.retry') }}</Button>
            </template>
            <template v-else-if="delivery.kind === 'entry-stopped'">{{ text('pageFrame.stopped', delivery.reason) }}</template>
            <template v-else-if="delivery.kind === 'entry-not-activatable'">{{ text('pageFrame.notActivatable', delivery.reason) }}</template>
            <template v-else-if="status === 'load-failed'">
                <span>{{ text('pageFrame.loadFailed', error ?? "") }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-reload @click="emit('reload')">{{ text('pageFrame.reload') }}</Button>
            </template>
            <template v-else>
                <span>{{ text('pageFrame.renderFailed', error ?? "") }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-retry-render @click="emit('retry-render')">{{ text('pageFrame.retry') }}</Button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.settings-page-frame {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

.settings-page-frame__notice {
    display: flex;
    min-height: 160px;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-5);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    text-align: center;
    overflow-wrap: anywhere;
}
</style>
