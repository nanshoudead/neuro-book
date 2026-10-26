<script setup lang="ts">
/**
 * SettingsPageActions 的 Lab 场景：没有窗口通道时操作原位渲染；有通道时画一条仿标题栏，操作 Teleport 到它的右侧，层不能写时
 * 整体停用。通道是产品里同一份 `createPageChrome`，这里只多出仿标题栏这个挂载点（真实的在设置窗口的标题区）。
 */
import {Button, IconButton} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, onMounted, provide, ref} from "vue";

import {createPageChrome, SETTINGS_PAGE_CHROME} from "nbook/ui/settings/page-chrome";
import SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";

import {useLabEventSink} from "../lab-event-sink";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();

/** 前两个场景没有通道：组件单独渲染。 */
const channeled = props.scene === "in-title" || props.scene === "disabled";
const writable = ref(props.scene !== "disabled");
const chrome = createPageChrome(writable);
if (channeled) provide(SETTINGS_PAGE_CHROME, chrome);

const target = ref<HTMLElement | null>(null);
let detach: (() => void) | null = null;
onMounted(() => {
    if (channeled && target.value !== null) detach = chrome.attachActions(target.value);
});
onBeforeUnmount(() => detach?.());
</script>

<template>
    <div class="settings-page-actions-fixture">
        <div v-if="channeled" class="settings-page-actions-fixture__title">
            <span class="settings-page-actions-fixture__heading">模型服务</span>
            <div ref="target" class="settings-page-actions-fixture__target"></div>
        </div>
        <SettingsPageActions data-lab-subject>
            <template v-if="scene === 'in-place'">
                <Button size="sm" variant="secondary" icon-class="i-lucide-plus" @click="record('add', null)">添加服务商</Button>
            </template>
            <template v-else>
                <Button size="sm" variant="secondary" icon-class="i-lucide-plug-zap" @click="record('test', null)">测试连接</Button>
                <IconButton size="sm" icon-class="i-lucide-trash-2" aria-label="删除服务商" @click="record('remove', null)" />
                <Button size="sm" variant="secondary" icon-class="i-lucide-plus" @click="record('add', null)">添加服务商</Button>
            </template>
        </SettingsPageActions>
    </div>
    <LabFixtureControls v-if="scene === 'disabled'">
        <Button size="sm" variant="ghost" @click="writable = !writable">{{ writable ? "层坏了" : "层恢复" }}</Button>
    </LabFixtureControls>
</template>

<style scoped>
.settings-page-actions-fixture {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
}

.settings-page-actions-fixture__title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
}

.settings-page-actions-fixture__heading {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    color: var(--text-main);
}

.settings-page-actions-fixture__target {
    display: flex;
    align-items: center;
}
</style>
