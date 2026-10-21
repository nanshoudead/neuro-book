<script setup lang="ts">
/**
 * SettingsRow 的 Lab 场景：配置服务来自设置场景的局部宿主（`settings-scene/`），各层的内容按场景给出；行拿到的是声明者
 * 插件自己的配置服务，与 page 页面一样。场景输入是行的数据属性，配置服务由这里补上。
 */
import {SchemaField} from "@notnotype/nb-form/vue";
import {computed, onBeforeUnmount} from "vue";

import {settingForm} from "nbook/plugins/settings/web/setting-form";
import type {SettingLayer} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import {createSettingsHost} from "./settings-scene/settings-host";
import type {HostLayer} from "./settings-scene/settings-host";
import {SCENE_SETTINGS} from "./settings-scene/scene-data";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const subject = useLabSubject<typeof SettingsRow>(() => props.input, ["write-failed"]);

/** 场景 → 各层的初始内容。 */
const LAYERS: Readonly<Record<string, {readonly user?: HostLayer; readonly project?: HostLayer}>> = {
    "modified": {user: {values: {"nbook.workbench/appearance": "dark"}}},
    "overridden": {user: {values: {"nbook.workbench/appearance": "system"}}, project: {values: {"nbook.workbench/appearance": "light"}}},
    "inherit": {user: {values: {"nbook.workbench/theme": "macos"}}, project: {}},
    "project-set": {project: {values: {"nbook.workbench/appearance": "light"}}},
    "invalid": {user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}},
    "unreachable": {user: {unreachable: true}},
    "wide": {user: {values: {"example.snippets/items": [{name: "旁白", text: "雾从港口漫上来。"}, {name: "落款", text: "——写于雾港"}]}}},
    "not-allowed": {project: {}},
};

const layers = LAYERS[props.scene] ?? {};
const host = createSettingsHost({
    settings: SCENE_SETTINGS,
    sections: [],
    ...(layers.user === undefined ? {} : {user: layers.user}),
    ...(layers.project === undefined ? {} : {project: layers.project}),
    projectTitle: "雾港",
    notify: (input) => record("notify", input),
    report: (message) => record("report", message),
});
onBeforeUnmount(() => host.dispose());

const bindings = computed(() => subject.bindings.value);
const setting = computed(() => bindings.value.setting);
/** 声明者自己的配置服务：恢复默认、单独设置与控件改值都只写它声明的这一项。 */
const settings = computed(() => host.service(SCENE_SETTINGS.find((entry) => entry.definition.key === setting.value.key)?.plugin ?? "nbook.workbench"));
const form = computed(() => settingForm(setting.value.declaration));

async function write(value: unknown, layer: SettingLayer): Promise<void> {
    const result = await settings.value.update(setting.value, value, {layer});
    if (!result.ok) record("write-failed", result);
}
</script>

<template>
    <SettingsRow v-slot="row" v-bind="bindings" :settings="settings" class="settings-row-fixture" data-lab-subject>
        <SchemaField
            :id="row.id"
            :schema="setting.declaration.schema"
            :hints="form.hints"
            :model-value="row.value"
            :locale="bindings.locale"
            :disabled="row.disabled"
            :labelledby="row.labelId"
            :describedby="row.describedby"
            bare
            @update:model-value="(value: unknown) => write(value, bindings.layer)"
        />
    </SettingsRow>
</template>

<style scoped>
/* 行把已修改竖线画在自己左边 --space-5 的留白里（同名 .md 的注意事项），放它的容器要留出这么多：这里留在行自己的外边距上。 */
.settings-row-fixture {
    width: calc(100% - var(--space-5));
    margin-left: var(--space-5);
}
</style>
