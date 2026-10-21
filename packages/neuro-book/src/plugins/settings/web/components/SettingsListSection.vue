<script setup lang="ts">
/**
 * list 分区的内容（同名 .md）：按分组列出配置项，每项一个 SettingsRow，里面放 nb-form 的 `SchemaField`（`bare`，名字与
 * 说明来自行），写入经窗口模型。控件、草稿与提交时机由表单定（docs/specs/settings/settings-window.md 输出 9、14）。
 */
import {SchemaField} from "@notnotype/nb-form/vue";
import {reactive} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {settingForm} from "../setting-form";
import type {SettingsSectionView, SettingsWindow} from "../settings-window";
import type {WindowSetting} from "../window-source";

defineOptions({name: "SettingsListSection"});

const props = defineProps<{
    window: SettingsWindow;
    view: Extract<SettingsSectionView, {kind: "list"}>;
}>();

const TEXT = {
    excludedUser: {"zh-CN": "{titles}只能在用户设置里改", "en-US": "{titles}: can only be changed in your settings"},
    excludedProject: {"zh-CN": "{titles}只能在本作品里设置", "en-US": "{titles}: can only be set for a book"},
} satisfies Record<string, LocalizedText>;

const locale = props.window.locale;

const formOf = (setting: WindowSetting) => settingForm(setting.definition.declaration);

/**
 * 写入没成功时加一：写入可能在下一次渲染之前就结算，表单看到的值从头到尾没变，要靠它丢掉草稿、回到实际值（ui.forms
 * 输出 16）。按键记，切换标签不清：只需要每次失败都与上一次不同。
 */
const revisions = reactive(new Map<string, number>());

async function write(setting: WindowSetting, value: unknown): Promise<void> {
    if (await props.window.write(setting, value)) return;
    const key = setting.definition.key;
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
}

function shown(setting: WindowSetting, value: unknown): unknown {
    const pending = props.window.pending(setting.definition.key);
    return pending === undefined ? value : pending.value;
}

function excludedText(titles: ReadonlyArray<string>): string {
    const separator = locale.value === "zh-CN" ? "、" : ", ";
    return localize(formatText(props.window.layer.value === "project" ? TEXT.excludedUser : TEXT.excludedProject, {titles: titles.join(separator)}), locale.value);
}
</script>

<template>
    <div class="settings-list-section" :data-settings-list="view.id">
        <section v-for="group in view.groups" :key="group.id ?? ''" class="settings-list-section__group" :data-settings-group="group.id ?? ''">
            <h3 v-if="group.title !== null" class="settings-list-section__group-title">{{ group.title }}</h3>
            <SettingsRow
                v-for="setting in group.settings"
                :key="setting.definition.key"
                v-slot="row"
                :settings="window.editing"
                :setting="setting.definition"
                :layer="window.layer.value"
                :locale="locale"
                :project-title="window.projectTitle.value"
                :wide="formOf(setting).wide"
                @write-failed="(failure) => window.rowFailed(setting, failure)"
            >
                <div class="settings-list-section__control" :data-settings-width="formOf(setting).wide ? undefined : formOf(setting).width">
                    <SchemaField
                        :id="row.id"
                        :schema="setting.definition.declaration.schema"
                        :hints="formOf(setting).hints"
                        :model-value="shown(setting, row.value)"
                        :locale="locale"
                        :disabled="row.disabled"
                        :labelledby="row.labelId"
                        :describedby="row.describedby"
                        :revision="revisions.get(setting.definition.key) ?? 0"
                        bare
                        commit="change"
                        @update:model-value="(value: unknown) => write(setting, value)"
                    />
                </div>
            </SettingsRow>
        </section>
        <p v-if="view.excluded.length > 0" class="settings-list-section__excluded" data-settings-excluded>{{ excludedText(view.excluded) }}</p>
    </div>
</template>

<style scoped>
.settings-list-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

.settings-list-section__group {
    display: flex;
    flex-direction: column;
}

.settings-list-section__group-title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

/* 标签列加控件列时的宽度（输出 9），都不超过行宽；宽排法占满内容列。 */
.settings-list-section__control {
    min-width: 0;
    max-width: 100%;
}

.settings-list-section__control[data-settings-width="narrow"] {
    width: 120px;
}

.settings-list-section__control[data-settings-width="medium"] {
    width: 220px;
}

.settings-list-section__control[data-settings-width="wide"] {
    width: 320px;
}

.settings-list-section__excluded {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}
</style>
