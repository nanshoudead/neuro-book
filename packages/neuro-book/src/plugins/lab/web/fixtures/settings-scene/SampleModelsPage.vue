<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”，docs/specs/settings/settings-window.md 输出 20、22）：page 分区用草稿、未保存
 * 保护与动态选项的样板。
 *
 * - 服务商列表是一个对象数组配置项，用 nb-form 的左列表右详情编辑（增删、上移下移、焦点与身份由表单管）。改动先进草稿，
 *   点“保存”才整组写进配置；草稿与已保存的值比较，不同就报 `context.dirty(true)`，窗口在离开前先确认。列表的增删排序
 *   直接给出新值、不进 `draft-state`，所以按值比较，`draft-state` 只补“有解析不了的输入”。
 * - “默认模型”与“推理强度”每项即时写入（同通用列表）；默认模型的选项来自同一插件的选项提供者（已保存的服务商的模型），
 *   经 `context.options` 交给字段。
 */
import {resolveForm, validateForm} from "@notnotype/nb-form";
import {describeIssues, SchemaField} from "@notnotype/nb-form/vue";
import type {DraftState} from "@notnotype/nb-form/vue";
import {Button, Separator} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, shallowRef, watch} from "vue";

import {settingHints} from "nbook/plugins/settings/web/setting-form";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {modelsSettings} from "./scene-settings";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

type Providers = typeof modelsSettings.providers extends SettingDefinition<infer T> ? T : never;

const TEXT = {
    save: "保存",
    discard: "放弃改动",
    notSaved: "还没保存：{reason}",
    failed: "没有保存：{reason}",
};

const providers = modelsSettings.providers;
const model = resolveForm(providers.declaration.schema);
const json = (value: unknown): string => JSON.stringify(value) ?? "";

const saved = computed(() => props.settings.get(providers));
/** 配置服务给的值是深冻结的只读值；草稿要能改，拿一份深拷贝。 */
const copy = (value: typeof saved.value): Providers => structuredClone(value) as Providers;
/** 表单每次交出整个新值、不在原值上改，所以草稿用浅层的 ref：写配置时交出去的是普通对象，不是 Vue 的代理（代理不能结构化复制）。 */
const draft = shallowRef<Providers>(copy(saved.value));
/** 解析不了的草稿（数字框里的 `abc`），按字段路径。 */
const unparseable = reactive(new Set<string>());
const failure = ref<string | null>(null);
const saving = ref(false);
const field = ref<InstanceType<typeof SchemaField> | null>(null);

const dirty = computed(() => json(draft.value) !== json(saved.value) || unparseable.size > 0);
watch(dirty, (value) => props.context.dirty(value), {immediate: true});
// 已保存的值在别处变了（另一个窗口、设置文件视图）：没有改动时跟上，有改动时留着草稿。
watch(saved, (next) => {
    if (!dirty.value) draft.value = copy(next);
});

const issues = computed(() => validateForm(model, draft.value).filter((issue) => issue.severity === "error"));

function onDraft(state: DraftState): void {
    const key = state.path.join("/");
    if (state.state === "unparseable") unparseable.add(key);
    else unparseable.delete(key);
}

async function save(): Promise<void> {
    if (saving.value) return;
    // 先把输入框里还没提交的草稿交出来（点按钮时它们已经失焦提交，键盘触发时不一定）。
    field.value?.commit();
    const [first] = describeIssues(providers.declaration.schema, draft.value, issues.value, "zh-CN", settingHints(providers.declaration));
    if (first !== undefined || unparseable.size > 0) {
        failure.value = TEXT.notSaved.replace("{reason}", first ?? "有解析不了的输入");
        return;
    }
    saving.value = true;
    try {
        const result = await props.settings.update(providers, draft.value, {layer: props.context.layer.value});
        failure.value = result.ok ? null : TEXT.failed.replace("{reason}", result.detail);
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    field.value?.reset();
    unparseable.clear();
    draft.value = copy(saved.value);
    failure.value = null;
}

async function writeNow(setting: SettingDefinition<unknown>, value: unknown): Promise<void> {
    await props.settings.update(setting, value, {layer: props.context.layer.value});
}
</script>

<template>
    <div class="sample-models" data-sample-models>
        <section class="sample-models__providers">
            <SchemaField
                ref="field"
                v-model="draft"
                :schema="providers.declaration.schema"
                :hints="{...settingHints(providers.declaration), label: providers.declaration.title}"
                :options="context.options"
                locale="zh-CN"
                commit="change"
                @draft-state="onDraft"
            />
            <div v-if="dirty || failure !== null" class="sample-models__actions" data-sample-models-actions>
                <Button size="sm" :disabled="saving || !dirty" @click="save">{{ TEXT.save }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving || !dirty" @click="discard">{{ TEXT.discard }}</Button>
                <p v-if="failure !== null" class="sample-models__failure" role="alert" data-sample-models-failure>{{ failure }}</p>
            </div>
        </section>
        <Separator class="sample-models__divider" />
        <section class="sample-models__more">
            <SettingsRow v-for="setting in [modelsSettings.defaultModel, modelsSettings.effort]" :key="setting.key" v-slot="row" :settings="settings" :setting="setting" :layer="context.layer.value" locale="zh-CN" :project-title="context.projectTitle.value">
                <SchemaField
                    :id="row.id"
                    :schema="setting.declaration.schema"
                    :hints="settingHints(setting.declaration)"
                    :options="context.options"
                    :model-value="row.value"
                    locale="zh-CN"
                    :disabled="row.disabled"
                    :labelledby="row.labelId"
                    :describedby="row.describedby"
                    bare
                    commit="change"
                    @update:model-value="(value: unknown) => writeNow(setting as SettingDefinition<unknown>, value)"
                />
            </SettingsRow>
        </section>
    </div>
</template>

<style scoped>
.sample-models {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-5);
    overflow-y: auto;
    padding: var(--space-2);
}

.sample-models__providers {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.sample-models__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.sample-models__failure {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

.sample-models__divider {
    flex-shrink: 0;
}

.sample-models__more {
    display: flex;
    flex-direction: column;
}
</style>
