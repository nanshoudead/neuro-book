<script setup lang="ts">
/**
 * 设置窗口里分区的标题、说明与层的提示（docs/specs/settings/settings-window.md 输出 3、13）。column 与 fill 两种画法共用：
 * column 里它随内容列一起滚动，fill 里它固定在页面上方。
 */
import {Button} from "@notnotype/nb-ui/components";

export interface SettingsSectionNotice {
    readonly kind: "invalid" | "unavailable";
    readonly text: string;
    /** 项目层的设置文件路径；用户层不给（状态根不发给浏览器）。 */
    readonly path: string | null;
}

defineProps<{
    title: string;
    description: string | null;
    notice: SettingsSectionNotice | null;
    /** 层的文件有错误时给“打开设置文件”；设置文件视图自己就是修的地方，不给。 */
    openFileLabel: string | null;
}>();

defineEmits<{(event: "open-file"): void}>();
</script>

<template>
    <div class="settings-section-heading">
        <header class="settings-section-heading__header">
            <h2 class="settings-section-heading__title">{{ title }}</h2>
            <p v-if="description !== null" class="settings-section-heading__description">{{ description }}</p>
        </header>
        <p v-if="notice !== null" class="settings-section-heading__notice" :data-settings-layer-notice="notice.kind" role="status">
            <span class="i-lucide-triangle-alert settings-section-heading__notice-icon" aria-hidden="true"></span>
            <span>{{ notice.text }}</span>
            <code v-if="notice.kind === 'invalid' && notice.path !== null" class="settings-section-heading__path">{{ notice.path }}</code>
            <Button v-if="notice.kind === 'invalid' && openFileLabel !== null" size="sm" variant="secondary" data-settings-open-file @click="$emit('open-file')">{{ openFileLabel }}</Button>
        </p>
    </div>
</template>

<style scoped>
.settings-section-heading {
    flex-shrink: 0;
}

.settings-section-heading__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
}

.settings-section-heading__title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    color: var(--text-main);
}

.settings-section-heading__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.settings-section-heading__notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-6);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

.settings-section-heading__notice-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
}

.settings-section-heading__path {
    min-width: 0;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}
</style>
