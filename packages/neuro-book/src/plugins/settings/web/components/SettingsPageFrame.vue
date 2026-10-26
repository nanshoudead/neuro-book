<script setup lang="ts">
/** page 分区的可见形态（同名 .md）：交付状态、加载、两种失败与错误边界；加载与代际由窗口模型决定。 */
import {Button, Spinner} from "@notnotype/nb-ui/components";
import {computed, defineComponent, onErrorCaptured} from "vue";
import type {Component, PropType} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {SettingsPageContext} from "../contracts";
import type {SettingsPageDelivery} from "../sections";
import type {SettingsPageStatus} from "../settings-window";

defineOptions({name: "SettingsPageFrame"});

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
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

const TEXT = {
    declared: {"zh-CN": "正在等待这个分区所属的插件启动", "en-US": "Waiting for this section's plugin to start"},
    blocked: {"zh-CN": "这个分区所属的插件无法启动：{reason}", "en-US": "This section's plugin cannot start: {reason}"},
    failed: {"zh-CN": "这个分区所属的插件启动失败：{reason}", "en-US": "This section's plugin failed to start: {reason}"},
    stopped: {"zh-CN": "这个分区所属的插件已停止（{reason}）", "en-US": "This section's plugin stopped ({reason})"},
    notActivatable: {"zh-CN": "插件没有声明打开分区时激活：{reason}", "en-US": "The plugin does not activate when this section opens: {reason}"},
    loading: {"zh-CN": "正在加载这个分区", "en-US": "Loading this section"},
    loadFailed: {"zh-CN": "这个分区加载失败：{reason}", "en-US": "This section failed to load: {reason}"},
    renderFailed: {"zh-CN": "这个分区出错：{reason}", "en-US": "This section crashed: {reason}"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    reload: {"zh-CN": "重新加载", "en-US": "Reload"},
} satisfies Record<string, LocalizedText>;

const text = (template: LocalizedText, reason = ""): string => localize(formatText(template, {reason}), props.locale);

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
            <span>{{ text(delivery.kind === "declared" ? TEXT.declared : TEXT.loading) }}</span>
        </div>
        <div v-else-if="failed" class="settings-page-frame__notice" role="alert">
            <template v-if="delivery.kind === 'entry-blocked'">{{ text(TEXT.blocked, delivery.reason) }}</template>
            <template v-else-if="delivery.kind === 'entry-failed'">
                <span>{{ text(TEXT.failed, delivery.reason) }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-retry-entry @click="emit('retry-entry')">{{ text(TEXT.retry) }}</Button>
            </template>
            <template v-else-if="delivery.kind === 'entry-stopped'">{{ text(TEXT.stopped, delivery.reason) }}</template>
            <template v-else-if="delivery.kind === 'entry-not-activatable'">{{ text(TEXT.notActivatable, delivery.reason) }}</template>
            <template v-else-if="status === 'load-failed'">
                <span>{{ text(TEXT.loadFailed, error ?? "") }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-reload @click="emit('reload')">{{ text(TEXT.reload) }}</Button>
            </template>
            <template v-else>
                <span>{{ text(TEXT.renderFailed, error ?? "") }}</span>
                <Button size="sm" variant="secondary" :disabled="busy" data-settings-page-retry-render @click="emit('retry-render')">{{ text(TEXT.retry) }}</Button>
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
