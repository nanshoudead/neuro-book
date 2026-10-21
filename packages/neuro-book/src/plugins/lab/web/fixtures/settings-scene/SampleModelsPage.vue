<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”，docs/specs/settings/settings-window.md 输出 19、20、22）：page 分区用草稿、
 * 未保存保护与动态选项的样板，第三方的设置页面可以照着写。
 *
 * - 版式照 t80 定的 fill 页面写法：左边设置插件导出的页内列表 `SettingsPageList`，右边是选中项的详情，两栏各自滚动。列表
 *   第一项“常规”放“默认模型”“推理强度”（每项即时写入，同通用列表），其后每家服务商一项，改过的带一个圆点。
 * - 详情里每个字段一行，标签在左、控件在右，控件宽度按类型分档（同设置窗口的通用列表，输出 9）；列表这类宽控件另起一行。
 * - 服务商是一个对象数组配置项。改动先进草稿，点“保存”才整组写进配置；草稿与开始编辑时的已保存值比较，不同就报
 *   `context.dirty(true)`，窗口在离开前先确认。草稿里每家服务商配一个只在页面里用的键：选中项、字段的重建与“解析不了的
 *   输入”的记号都按它认，不按下标（别处增删、删掉中间一家时下标会对上另一家）。标识可能还没填或重复，不能当键。
 * - 别处改了已保存的值（另一个窗口、设置文件视图）：没有改动时跟上，键按标识认回来，选中的那家还在就仍选着它；有改动时
 *   提示，保存前要用户选“重新读取”或“仍然保存”，不悄悄盖掉别人的改动。
 * - 这一层不能写（设置文件有错误、连不上）时由 `inspect` 知道，表单只读、保存停用，不用等保存被拒。
 * - 操作行在详情下方、不随详情滚走：详情会滚动，放在上方滚下去就看不见。设置文件视图是一个铺满的文本框，它的操作行与
 *   文件名同一行、在文本框上面（输出 23），两处位置不同是有意的。选“常规”且没有改动时不显示：那两项即时写入，与草稿无关。
 * - 默认模型的选项来自同一插件的选项提供者（已保存的服务商的模型），经 `context.options` 交给字段。
 */
import {resolveForm, validateForm} from "@notnotype/nb-form";
import type {FormText} from "@notnotype/nb-form";
import {describeIssues, SchemaField, widgetLayout} from "@notnotype/nb-form/vue";
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
/** 草稿里的一家服务商与它在页面里的键。 */
interface Entry {
    readonly key: string;
    readonly provider: Provider;
}

const TEXT = {
    list: "模型服务",
    general: "常规",
    untitled: "未命名的服务商",
    add: "添加服务商",
    remove: "删除",
    removeLabel: "删除：{name}",
    edited: "有改动",
    save: "保存",
    discard: "放弃改动",
    unsaved: "服务商有没保存的改动",
    reread: "重新读取",
    saveAnyway: "仍然保存",
    changedElsewhere: "服务商在别处改过了：“重新读取”丢掉这里的改动，“仍然保存”盖掉别处的改动",
    notSaved: "还没保存：{reason}",
    failed: "没有保存：{reason}",
    readonly: "这一层现在不能保存（设置文件有错误或连不上）",
};

const GENERAL = "general";
const providers = modelsSettings.providers;
const model = resolveForm(providers.declaration.schema);
const uid = useId();

/** 详情的字段：按 schema 的属性顺序一行一个。 */
const FIELDS = Object.entries(ProviderSchema.properties).map(([name, schema]) => {
    const hints = (schema as {"x-form"?: {label?: FormText; help?: FormText}})["x-form"] ?? {};
    return {name, schema, label: hints.label ?? name, help: hints.help, layout: widgetLayout(schema)};
});
const text = (value: FormText | undefined): string => (value === undefined ? "" : typeof value === "string" ? value : value["zh-CN"] ?? "");

const saved = computed(() => props.settings.get(providers));
let nextKey = 0;
/**
 * 把一份已保存的服务商变成草稿：配置服务给的值是深冻结的只读值，草稿要能改，拿一份深拷贝；键按标识从原来的草稿里认回来
 * （没有或重复的给新键），别处改动之后选中的那家还能选着。
 */
function adopt(value: typeof saved.value, previous: ReadonlyArray<Entry>): Entry[] {
    const unused = [...previous];
    return (structuredClone(value) as Providers).map((provider) => {
        const at = provider.id === "" ? -1 : unused.findIndex((entry) => entry.provider.id === provider.id);
        const key = at < 0 ? `p${String(nextKey++)}` : unused.splice(at, 1)[0]!.key;
        return {key, provider};
    });
}
/** 每次改都换一个新数组、不在原值上改，所以草稿用浅层的 ref：写配置时交出去的是普通对象，不是 Vue 的代理（代理不能结构化复制）。 */
const entries = shallowRef<Entry[]>(adopt(saved.value, []));
/** 开始编辑时的已保存值：保存前和它比，知道别处有没有改过；按键记一份，列表据此标出改过的服务商。 */
const base = shallowRef(saved.value);
const baseByKey = shallowRef(new Map(entries.value.map((entry) => [entry.key, canonical(entry.provider)])));
/** 解析不了的草稿（数字框里的 `abc`），按“服务商的键/字段/路径”。 */
const unparseable = reactive(new Set<string>());
const failure = ref<string | null>(null);
const saving = ref(false);
const selected = ref<string>(GENERAL);
const fields = ref<Array<InstanceType<typeof SchemaField>>>([]);

const draft = computed((): Providers => entries.value.map((entry) => entry.provider));
// 键序不同的同一个值不算改动：按规范化的文本比。
const dirty = computed(() => canonical(draft.value) !== canonical(base.value) || unparseable.size > 0);
const changedElsewhere = computed(() => canonical(saved.value) !== canonical(base.value));
const writable = computed(() => props.settings.inspect(providers)[props.context.layer.value].status === "ok");
watch(dirty, (value) => props.context.dirty(value), {immediate: true});
watch(saved, (next) => {
    if (!dirty.value) reset(next);
});

function reset(value: typeof saved.value): void {
    entries.value = adopt(value, entries.value);
    base.value = value;
    baseByKey.value = new Map(entries.value.map((entry) => [entry.key, canonical(entry.provider)]));
    unparseable.clear();
    failure.value = null;
}

const edited = (entry: Entry): boolean => baseByKey.value.get(entry.key) !== canonical(entry.provider) || [...unparseable].some((key) => key.startsWith(`${entry.key}/`));
const titleOf = (provider: Provider): string => (provider.name === "" ? TEXT.untitled : provider.name);
const items = computed((): SettingsPageListItem[] => [
    {id: GENERAL, title: TEXT.general, icon: "i-lucide-sliders-horizontal"},
    ...entries.value.map((entry) => ({
        id: entry.key,
        title: titleOf(entry.provider),
        icon: "i-lucide-server",
        ...(entry.provider.baseUrl === "" ? {} : {description: entry.provider.baseUrl}),
    })),
]);
const editedKeys = computed(() => new Set(entries.value.filter(edited).map((entry) => entry.key)));
const current = computed((): Entry | null => entries.value.find((entry) => entry.key === selected.value) ?? null);
// 选中的服务商被删掉、或别处的改动让它不在了，回到“常规”。
watch(current, (entry) => {
    if (entry === null && selected.value !== GENERAL) selected.value = GENERAL;
});
const showActions = computed(() => current.value !== null || dirty.value);

const issues = computed(() => validateForm(model, draft.value).filter((issue) => issue.severity === "error"));

/*
 * 字段的事件处理按“键/字段”缓存、在渲染时交给字段：切换服务商时旧字段在新的渲染之后才卸载，卸载时补发的 `draft-state`
 * 要记回它自己那家；`@…` 的内联语句在调用时才读当前选中项，会记到新选中的那家。所以写成 `:onUpdate:modelValue` 这样的
 * 属性绑定（Vue 按驼峰的 `on…` 键找监听器，写成连字符的找不到）。
 */
const handlers = new Map<string, {update: (value: unknown) => void; draft: (state: DraftState) => void}>();
function handlersFor(key: string, name: string) {
    const id = `${key}/${name}`;
    let found = handlers.get(id);
    if (found === undefined) {
        found = {
            update: (value) => updateField(key, name, value),
            draft: (state) => {
                const mark = [id, ...state.path].join("/");
                if (state.state === "unparseable") unparseable.add(mark);
                else unparseable.delete(mark);
            },
        };
        handlers.set(id, found);
    }
    return found;
}

function updateField(key: string, name: string, value: unknown): void {
    entries.value = entries.value.map((entry) => {
        if (entry.key !== key) return entry;
        const next: Record<string, unknown> = {...entry.provider};
        if (value === undefined) delete next[name];
        else next[name] = value;
        return {key, provider: next as Provider};
    });
}

function addProvider(): void {
    const key = `p${String(nextKey++)}`;
    entries.value = [...entries.value, {key, provider: {id: "", name: "", baseUrl: "", timeout: 30}}];
    selected.value = key;
}

function removeProvider(key: string): void {
    entries.value = entries.value.filter((entry) => entry.key !== key);
    for (const mark of [...unparseable]) if (mark.startsWith(`${key}/`)) unparseable.delete(mark);
    selected.value = GENERAL;
}

async function save(anyway = false): Promise<void> {
    if (saving.value || !writable.value) return;
    if (changedElsewhere.value && !anyway) return;
    // 先把输入框里还没提交的草稿交出来（点按钮时它们已经失焦提交，键盘触发时不一定）。
    for (const field of fields.value) field.commit();
    const [first] = describeIssues(providers.declaration.schema, draft.value, issues.value, "zh-CN", settingHints(providers.declaration));
    if (first !== undefined || unparseable.size > 0) {
        failure.value = TEXT.notSaved.replace("{reason}", first ?? "有解析不了的输入");
        return;
    }
    saving.value = true;
    try {
        const result = await props.settings.update(providers, draft.value, {layer: props.context.layer.value});
        if (result.ok) reset(saved.value);
        else failure.value = TEXT.failed.replace("{reason}", settingsFailureText(result.code, result.detail, "zh-CN"));
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    for (const field of fields.value) field.reset();
    reset(saved.value);
}

async function writeNow(setting: SettingDefinition<unknown>, value: unknown): Promise<void> {
    await props.settings.update(setting, value, {layer: props.context.layer.value});
}
</script>

<template>
    <div class="sample-models" data-sample-models>
        <div class="sample-models__list">
            <SettingsPageList v-model="selected" :items="items" :label="TEXT.list">
                <template #end="{item}">
                    <span v-if="editedKeys.has(item.id)" class="sample-models__edited" :title="TEXT.edited" data-sample-models-edited>
                        <span class="sample-models__visually-hidden">{{ TEXT.edited }}</span>
                    </span>
                </template>
            </SettingsPageList>
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
                        <h3 class="sample-models__title">{{ titleOf(current.provider) }}</h3>
                        <Button size="sm" variant="ghost" icon-class="i-lucide-trash-2" :disabled="!writable" :aria-label="TEXT.removeLabel.replace('{name}', titleOf(current.provider))" @click="removeProvider(current.key)">{{ TEXT.remove }}</Button>
                    </div>
                    <div :key="current.key" class="sample-models__fields" data-sample-models-detail>
                        <div v-for="field in FIELDS" :key="field.name" class="sample-models__row" :class="{'sample-models__row--block': field.layout.block}">
                            <div class="sample-models__label">
                                <label :id="`${uid}-${current.key}-${field.name}-label`" :for="`${uid}-${current.key}-${field.name}`">{{ text(field.label) }}</label>
                                <p v-if="field.help !== undefined" :id="`${uid}-${current.key}-${field.name}-help`" class="sample-models__help">{{ text(field.help) }}</p>
                            </div>
                            <div class="sample-models__control" :data-sample-models-width="field.layout.block ? undefined : field.layout.width">
                                <SchemaField
                                    :id="`${uid}-${current.key}-${field.name}`"
                                    ref="fields"
                                    :schema="field.schema"
                                    :model-value="(current.provider as Record<string, unknown>)[field.name]"
                                    :options="context.options"
                                    :readonly="!writable"
                                    :labelledby="`${uid}-${current.key}-${field.name}-label`"
                                    :describedby="field.help === undefined ? undefined : `${uid}-${current.key}-${field.name}-help`"
                                    locale="zh-CN"
                                    bare
                                    commit="change"
                                    :onUpdate:modelValue="handlersFor(current.key, field.name).update"
                                    :onDraftState="handlersFor(current.key, field.name).draft"
                                />
                            </div>
                        </div>
                    </div>
                </template>
            </div>
            <div v-if="showActions" class="sample-models__actions" data-sample-models-actions>
                <p v-if="!writable" class="sample-models__status" role="status">{{ TEXT.readonly }}</p>
                <p v-else-if="dirty && changedElsewhere" class="sample-models__status" role="status" data-sample-models-changed>
                    <span>{{ TEXT.changedElsewhere }}</span>
                    <Button size="sm" variant="secondary" @click="discard">{{ TEXT.reread }}</Button>
                    <Button size="sm" variant="secondary" :disabled="saving" @click="save(true)">{{ TEXT.saveAnyway }}</Button>
                </p>
                <p v-else-if="failure !== null" class="sample-models__status" role="alert" data-sample-models-failure>{{ failure }}</p>
                <span v-else-if="dirty" class="sample-models__status">{{ TEXT.unsaved }}</span>
                <span class="sample-models__spacer" />
                <!-- 别处改过时“重新读取”就是放弃改动，不再并排一个同样的按钮。 -->
                <Button v-if="!changedElsewhere" size="sm" variant="secondary" :disabled="saving || !dirty" @click="discard">{{ TEXT.discard }}</Button>
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

.sample-models__edited {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
}

.sample-models__visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    margin-bottom: var(--space-2);
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

/* 详情的一行：同 SettingsRow 的标签列加控件列，标签列窄一些（详情区只有窗口的一半宽）。 */
.sample-models__fields {
    display: flex;
    flex-direction: column;
}

.sample-models__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    padding-block: var(--space-4);
}

.sample-models__row--block {
    flex-direction: column;
    align-items: stretch;
}

.sample-models__label {
    width: 120px;
    flex-shrink: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.sample-models__row--block .sample-models__label {
    width: auto;
}

.sample-models__help {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.sample-models__control {
    min-width: 0;
    max-width: 100%;
}

.sample-models__control[data-sample-models-width="narrow"] {
    width: 120px;
}

.sample-models__control[data-sample-models-width="medium"] {
    width: 220px;
}

.sample-models__control[data-sample-models-width="wide"] {
    min-width: 200px;
    max-width: 320px;
    flex: 1;
}

.sample-models__actions {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0 var(--space-4) var(--space-7);
    border-top: var(--border-w) solid var(--divider);
    background: var(--bg-panel);
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

/*
 * 窄的窗口（窗口拖到最窄、手机宽度的画布）：窗口的左栏与内容改成上下、由外层一起滚动（SettingsWindow 的同一档），两栏也
 * 改成上下、不再各自滚；操作行粘在可视区底部，长详情里改了也看得到“保存”。
 */
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

    .sample-models__actions {
        position: sticky;
        bottom: 0;
        z-index: 1;
    }
}
</style>
