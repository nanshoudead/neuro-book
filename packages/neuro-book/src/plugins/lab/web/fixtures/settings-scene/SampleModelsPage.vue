<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”，docs/specs/settings/settings-window.md 输出 19、20、22）：page 分区用草稿、
 * 未保存保护与动态选项的样板，第三方的设置页面可以照着写。
 *
 * - 版式照 t80 定的 fill 页面写法：左边设置插件导出的页内列表 `SettingsPageList`，右边是选中项的详情，两栏各自滚动。列表
 *   第一项“常规”放“默认模型”“推理强度”（每项即时写入，同通用列表），其后每家服务商一项。
 * - 服务商是一个对象数组配置项。改动先进草稿，点“保存”才整组写进配置；草稿与开始编辑时的已保存值比较，不同就报
 *   `context.dirty(true)`，窗口在离开前先确认。增删直接给出新值、不进 `draft-state`，所以按值比较，`draft-state` 只补
 *   “有解析不了的输入”。“保存”“放弃改动”在详情下方的操作行里，一直在，没有改动时停用。
 * - 别处改了已保存的值（另一个窗口、设置文件视图）：没有改动时跟上；有改动时提示，保存前要用户选“重新读取”或“仍然保存”，
 *   不悄悄盖掉别人的改动。
 * - 这一层不能写（设置文件有错误、连不上）时由 `inspect` 知道，表单只读、保存停用，不用等保存被拒。
 * - 默认模型的选项来自同一插件的选项提供者（已保存的服务商的模型），经 `context.options` 交给字段。
 */
import {resolveForm, validateForm} from "@notnotype/nb-form";
import {describeIssues, SchemaField} from "@notnotype/nb-form/vue";
import type {DraftState} from "@notnotype/nb-form/vue";
import {Button} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, shallowRef, useId, watch} from "vue";

import {canonical} from "nbook/plugins/settings/shared/layers";
import {settingHints} from "nbook/plugins/settings/web/setting-form";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import type {SettingsPageListItem} from "nbook/ui/settings/SettingsPageList.vue";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {modelsSettings, ProviderSchema} from "./scene-settings";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

type Providers = typeof modelsSettings.providers extends SettingDefinition<infer T> ? T : never;
type Provider = Providers[number];

const TEXT = {
    list: "模型服务",
    general: "常规",
    untitled: "未命名的服务商",
    add: "添加服务商",
    remove: "删除",
    removeLabel: "删除：{name}",
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

/** 列表里“常规”一项的 id；服务商按下标编 id（草稿里的标识可能还没填或重复）。 */
const GENERAL = "general";
const providerId = (index: number) => `provider-${String(index)}`;

const providers = modelsSettings.providers;
const model = resolveForm(providers.declaration.schema);

const saved = computed(() => props.settings.get(providers));
/** 配置服务给的值是深冻结的只读值；草稿要能改，拿一份深拷贝。 */
const copy = (value: typeof saved.value): Providers => structuredClone(value) as Providers;
/** 每次改都换一个新数组、不在原值上改，所以草稿用浅层的 ref：写配置时交出去的是普通对象，不是 Vue 的代理（代理不能结构化复制）。 */
const draft = shallowRef<Providers>(copy(saved.value));
/** 开始编辑时的已保存值：保存前和它比，知道别处有没有改过。 */
const base = shallowRef(saved.value);
/** 解析不了的草稿（数字框里的 `abc`），按“服务商下标/字段路径”。 */
const unparseable = reactive(new Set<string>());
const failure = ref<string | null>(null);
const saving = ref(false);
const selected = ref<string>(GENERAL);
const field = ref<InstanceType<typeof SchemaField> | null>(null);
const headingId = `sample-models-heading-${useId()}`;

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

const items = computed((): SettingsPageListItem[] => [
    {id: GENERAL, title: TEXT.general, icon: "i-lucide-sliders-horizontal"},
    ...draft.value.map((provider, index) => ({
        id: providerId(index),
        title: provider.name === "" ? TEXT.untitled : provider.name,
        icon: "i-lucide-server",
        ...(provider.baseUrl === "" ? {} : {description: provider.baseUrl}),
    })),
]);
const selectedIndex = computed(() => draft.value.findIndex((_, index) => providerId(index) === selected.value));
const current = computed((): Provider | null => draft.value[selectedIndex.value] ?? null);
// 选中的服务商被删掉、或别处的改动让它不在了，回到“常规”。
watch(current, (provider) => {
    if (provider === null && selected.value !== GENERAL) selected.value = GENERAL;
});

const issues = computed(() => validateForm(model, draft.value).filter((issue) => issue.severity === "error"));

function onDraft(index: number, state: DraftState): void {
    const key = [index, ...state.path].join("/");
    if (state.state === "unparseable") unparseable.add(key);
    else unparseable.delete(key);
}

function updateProvider(index: number, value: unknown): void {
    draft.value = draft.value.map((provider, at) => (at === index ? value as Provider : provider));
}

function addProvider(): void {
    draft.value = [...draft.value, {id: "", name: "", baseUrl: "", timeout: 30}];
    selected.value = providerId(draft.value.length - 1);
}

function removeProvider(index: number): void {
    draft.value = draft.value.filter((_, at) => at !== index);
    // 删掉的那一项之后的草稿记号整体前移一位，与新下标对上。
    const shifted = [...unparseable].flatMap((key) => {
        const [head, ...rest] = key.split("/");
        const at = Number(head);
        if (at === index) return [];
        return [[at > index ? at - 1 : at, ...rest].join("/")];
    });
    unparseable.clear();
    for (const key of shifted) unparseable.add(key);
    selected.value = GENERAL;
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
        <div class="sample-models__list">
            <SettingsPageList v-model="selected" :items="items" :label="TEXT.list" />
            <Button class="sample-models__add" size="sm" variant="secondary" icon-class="i-lucide-plus" :disabled="!writable" data-sample-models-add @click="addProvider">{{ TEXT.add }}</Button>
        </div>
        <div class="sample-models__detail">
            <div class="sample-models__body">
                <template v-if="current === null">
                    <h3 class="sample-models__title">{{ TEXT.general }}</h3>
                    <SettingsRow v-for="setting in [modelsSettings.defaultModel, modelsSettings.effort]" :key="setting.key" v-slot="row" :settings="settings" :setting="setting" :layer="context.layer.value" locale="zh-CN" :project-title="context.projectTitle.value">
                        <div class="sample-models__control">
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
                        </div>
                    </SettingsRow>
                </template>
                <template v-else>
                    <div class="sample-models__heading">
                        <h3 :id="headingId" class="sample-models__title">{{ current.name === "" ? TEXT.untitled : current.name }}</h3>
                        <Button size="sm" variant="ghost" icon-class="i-lucide-trash-2" :disabled="!writable" :aria-label="TEXT.removeLabel.replace('{name}', current.name === '' ? TEXT.untitled : current.name)" @click="removeProvider(selectedIndex)">{{ TEXT.remove }}</Button>
                    </div>
                    <div class="sample-models__fields" data-sample-models-detail>
                        <SchemaField
                            :key="selected"
                            ref="field"
                            :schema="ProviderSchema"
                            :model-value="current"
                            :options="context.options"
                            :readonly="!writable"
                            :labelledby="headingId"
                            locale="zh-CN"
                            bare
                            commit="change"
                            @update:model-value="(value: unknown) => updateProvider(selectedIndex, value)"
                            @draft-state="(state: DraftState) => onDraft(selectedIndex, state)"
                        />
                    </div>
                </template>
            </div>
            <!-- 草稿的操作行在详情下方、不随详情滚走：按钮一直在，没有改动时停用。 -->
            <div class="sample-models__actions" data-sample-models-actions>
                <p v-if="!writable" class="sample-models__status" role="status">{{ TEXT.readonly }}</p>
                <p v-else-if="dirty && changedElsewhere" class="sample-models__status" role="status" data-sample-models-changed>
                    <span>{{ TEXT.changedElsewhere }}</span>
                    <Button size="sm" variant="secondary" @click="discard">{{ TEXT.reread }}</Button>
                    <Button size="sm" variant="secondary" :disabled="saving" @click="save(true)">{{ TEXT.saveAnyway }}</Button>
                </p>
                <p v-else-if="failure !== null" class="sample-models__status" role="alert" data-sample-models-failure>{{ failure }}</p>
                <span v-else-if="dirty" class="sample-models__status">{{ TEXT.unsaved }}</span>
                <span class="sample-models__spacer" />
                <Button size="sm" variant="secondary" :disabled="saving || !dirty" @click="discard">{{ TEXT.discard }}</Button>
                <Button size="sm" :disabled="saving || !dirty || !writable || changedElsewhere" @click="save()">{{ TEXT.save }}</Button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 两栏：左边列表、右边详情，各自滚动；分隔线与设置窗口左栏的同款（t80 定稿）。 */
.sample-models {
    display: flex;
    height: 100%;
    min-height: 0;
    gap: 0;
}

.sample-models__list {
    display: flex;
    width: 200px;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
    padding: var(--space-1) var(--space-5) var(--space-5) var(--space-1);
    border-right: var(--border-w) solid var(--divider);
}

.sample-models__add {
    align-self: flex-start;
    margin-left: var(--space-2);
}

.sample-models__detail {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}

/* 左边留出已修改竖线的位置（SettingsRow 把它画在行左边 --space-5 处）。 */
.sample-models__body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: var(--space-1) var(--space-1) var(--space-5) var(--space-7);
}

.sample-models__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
}

.sample-models__title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.sample-models__heading .sample-models__title {
    margin: 0;
}

.sample-models__control {
    min-width: 0;
    max-width: 100%;
}

.sample-models__actions {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0 var(--space-4) var(--space-7);
    border-top: var(--border-w) solid var(--divider);
}

.sample-models__spacer {
    flex: 1;
}

.sample-models__status {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

/* 窄的窗口（手机宽度的画布）：窗口的左栏与内容改成上下、由外层一起滚动（SettingsWindow 的同一档），两栏也改成上下、不再各自滚。 */
@container (max-width: 600px) {
    .sample-models {
        height: auto;
        flex-direction: column;
    }

    .sample-models__list {
        width: auto;
        overflow: visible;
        padding-right: var(--space-1);
        border-right: 0;
        border-bottom: var(--border-w) solid var(--divider);
    }

    .sample-models__body {
        overflow: visible;
        padding-top: var(--space-5);
    }
}
</style>
