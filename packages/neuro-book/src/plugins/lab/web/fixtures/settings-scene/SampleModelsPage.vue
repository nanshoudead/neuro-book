<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”，docs/specs/settings/settings-window.md 输出 20、22）：page 分区用草稿、未保存
 * 保护与动态选项的样板，第三方的设置页面可以照着写。
 *
 * - 服务商列表是一个对象数组配置项，用 nb-form 的左列表右详情编辑（增删、上移下移、焦点与身份由表单管）。改动先进草稿，
 *   点“保存”才整组写进配置；草稿与开始编辑时的已保存值比较，不同就报 `context.dirty(true)`，窗口在离开前先确认。列表的
 *   增删排序直接给出新值、不进 `draft-state`，所以按值比较，`draft-state` 只补“有解析不了的输入”。
 * - 别处改了已保存的值（另一个窗口、设置文件视图）：没有改动时跟上；有改动时提示，保存前要用户选“重新读取”或“仍然保存”，
 *   不悄悄盖掉别人的改动。
 * - 这一层不能写（设置文件有错误、连不上）时由 `inspect` 知道，表单只读、保存停用，不用等保存被拒。
 * - “默认模型”与“推理强度”每项即时写入（同通用列表），放在服务商上面：草稿的操作行与它们不混在一起。默认模型的选项来自
 *   同一插件的选项提供者（已保存的服务商的模型），经 `context.options` 交给字段。
 */
import {resolveForm, validateForm} from "@notnotype/nb-form";
import {describeIssues, SchemaField} from "@notnotype/nb-form/vue";
import type {DraftState} from "@notnotype/nb-form/vue";
import {Button} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, shallowRef, watch} from "vue";

import {canonical} from "nbook/plugins/settings/shared/layers";
import {settingHints} from "nbook/plugins/settings/web/setting-form";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
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
    unsaved: "有没保存的改动",
    reread: "重新读取",
    saveAnyway: "仍然保存",
    changedElsewhere: "服务商在别处改过了；“重新读取”会丢掉这里的改动，“仍然保存”会盖掉别处的改动",
    notSaved: "还没保存：{reason}",
    failed: "没有保存：{reason}",
    readonly: "这一层现在不能保存（设置文件有错误或连不上）",
};

const providers = modelsSettings.providers;
const model = resolveForm(providers.declaration.schema);

const saved = computed(() => props.settings.get(providers));
/** 配置服务给的值是深冻结的只读值；草稿要能改，拿一份深拷贝。 */
const copy = (value: typeof saved.value): Providers => structuredClone(value) as Providers;
/** 表单每次交出整个新值、不在原值上改，所以草稿用浅层的 ref：写配置时交出去的是普通对象，不是 Vue 的代理（代理不能结构化复制）。 */
const draft = shallowRef<Providers>(copy(saved.value));
/** 开始编辑时的已保存值：保存前和它比，知道别处有没有改过。 */
const base = shallowRef(saved.value);
/** 解析不了的草稿（数字框里的 `abc`），按字段路径。 */
const unparseable = reactive(new Set<string>());
const failure = ref<string | null>(null);
const saving = ref(false);
const field = ref<InstanceType<typeof SchemaField> | null>(null);

// 键序不同的同一个值不算改动：按规范化的文本比。
const dirty = computed(() => canonical(draft.value) !== canonical(base.value) || unparseable.size > 0);
const changedElsewhere = computed(() => canonical(saved.value) !== canonical(base.value));
const writable = computed(() => props.settings.inspect(providers)[props.context.layer.value].status === "ok");
watch(dirty, (value) => props.context.dirty(value), {immediate: true});
watch(saved, (next) => {
    if (dirty.value) return;
    draft.value = copy(next);
    base.value = next;
});

const issues = computed(() => validateForm(model, draft.value).filter((issue) => issue.severity === "error"));

function onDraft(state: DraftState): void {
    const key = state.path.join("/");
    if (state.state === "unparseable") unparseable.add(key);
    else unparseable.delete(key);
}

async function save(anyway = false): Promise<void> {
    if (saving.value || !writable.value) return;
    if (changedElsewhere.value && !anyway) return;
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
        if (result.ok) {
            base.value = saved.value;
            failure.value = null;
        } else failure.value = TEXT.failed.replace("{reason}", settingsFailureText(result.code, result.detail, "zh-CN"));
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    field.value?.reset();
    unparseable.clear();
    draft.value = copy(saved.value);
    base.value = saved.value;
    failure.value = null;
}

async function writeNow(setting: SettingDefinition<unknown>, value: unknown): Promise<void> {
    await props.settings.update(setting, value, {layer: props.context.layer.value});
}
</script>

<template>
    <div class="sample-models" data-sample-models>
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
        <section class="sample-models__providers">
            <!-- 草稿的操作行在列表上面、滚动时粘在顶上：详情很长，放在下面时有改动也看不到按钮。按钮一直在，没有改动时停用。 -->
            <div class="sample-models__actions" data-sample-models-actions>
                <span v-if="dirty" class="sample-models__unsaved">{{ TEXT.unsaved }}</span>
                <span class="sample-models__spacer" />
                <Button size="sm" :disabled="saving || !dirty || !writable || changedElsewhere" @click="save()">{{ TEXT.save }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving || !dirty" @click="discard">{{ TEXT.discard }}</Button>
            </div>
            <p v-if="!writable" class="sample-models__failure" role="status">{{ TEXT.readonly }}</p>
            <p v-if="dirty && changedElsewhere" class="sample-models__failure" role="status" data-sample-models-changed>
                <span>{{ TEXT.changedElsewhere }}</span>
                <Button size="sm" variant="secondary" @click="discard">{{ TEXT.reread }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving || !writable" @click="save(true)">{{ TEXT.saveAnyway }}</Button>
            </p>
            <p v-if="failure !== null" class="sample-models__failure" role="alert" data-sample-models-failure>{{ failure }}</p>
            <SchemaField
                ref="field"
                v-model="draft"
                :schema="providers.declaration.schema"
                :hints="{...settingHints(providers.declaration), label: providers.declaration.title}"
                :options="context.options"
                :readonly="!writable"
                locale="zh-CN"
                commit="change"
                @draft-state="onDraft"
            />
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
    padding: 0 var(--space-2) var(--space-2);
}

.sample-models__more {
    display: flex;
    flex-direction: column;
}

.sample-models__providers {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.sample-models__actions {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
    background: var(--bg-panel);
}

.sample-models__spacer {
    flex: 1;
}

.sample-models__unsaved {
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

.sample-models__failure {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}
</style>
