<script setup lang="ts">
/**
 * SettingsPageList 的 Lab 场景：组件是受控的，打开哪一项由 Lab 的 model 层持有（点一行、点返回都只改它）。有窗口通道的场景
 * 里画一条仿标题栏，读通道里的标题替换（产品里读它的是设置窗口的标题区）；没有通道的场景里组件在详情上方自己画“‹ 返回”。
 * 通道是产品里同一份 `createPageChrome`。
 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, provide, ref} from "vue";

import {createPageChrome, SETTINGS_PAGE_CHROME} from "nbook/ui/settings/page-chrome";
import SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import {provideSettingsText} from "./settings-scene/settings-text";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SettingsPageList>(() => props.input);
provideSettingsText(props.scene);

const channeled = props.scene === "open-in-title";
const chrome = createPageChrome(ref(true));
if (channeled) provide(SETTINGS_PAGE_CHROME, chrome);
const claim = computed(() => chrome.titleClaim.value);
</script>

<template>
    <div class="settings-page-list-fixture" data-lab-subject>
        <div v-if="channeled" class="settings-page-list-fixture__title">
            <Button v-if="claim !== null" size="sm" variant="ghost" icon-class="i-lucide-chevron-left" @click="claim.back()">模型服务</Button>
            <span class="settings-page-list-fixture__heading">{{ claim === null ? "模型服务" : claim.title }}</span>
        </div>
        <SettingsPageList v-bind="subject.bindings.value">
            <template #default="{item}">
                <p class="settings-page-list-fixture__detail">{{ item.title }} 的内容：由页面自己画的字段。</p>
            </template>
        </SettingsPageList>
    </div>
</template>

<style scoped>
.settings-page-list-fixture {
    display: flex;
    width: 100%;
    max-width: 560px;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-7);
}

.settings-page-list-fixture__title {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
}

.settings-page-list-fixture__heading {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    color: var(--text-main);
}

.settings-page-list-fixture__detail {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}
</style>
