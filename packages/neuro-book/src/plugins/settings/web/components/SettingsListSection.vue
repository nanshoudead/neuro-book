<script setup lang="ts">
/**
 * list 分区的内容（同名 .md）：按分组列出配置项，每项一个 SettingsRow，里面放 nb-form 的 `SchemaField`（`bare`，名字与
 * 说明来自行），写入经窗口模型。控件、草稿与提交时机由表单定（docs/specs/settings/settings-window.md 输出 9、14）。
 *
 * 行里显示的值按先后取：留在行里没写的值、写入中的值、层里的实际值。没写的原因（结构字段的值还不合格、数字框里
 * 写的不是数）在控件下面一行写出：单个字段没有问题汇总，不写出来用户只看到一个标红的框。
 */
import {toPointer} from "@notnotype/nb-form";
import type {FormIssue} from "@notnotype/nb-form";
import {describeIssues, SchemaField} from "@notnotype/nb-form/vue";
import type {DraftState} from "@notnotype/nb-form/vue";
import {reactive, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {settingErrors, settingForm} from "../setting-form";
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
    notSaved: {"zh-CN": "还没保存：{reason}", "en-US": "Not saved yet: {reason}"},
} satisfies Record<string, LocalizedText>;

const locale = props.window.locale;

const formOf = (setting: WindowSetting) => settingForm(setting.definition.declaration);

/**
 * 结构字段还不合格的值：留在行里、不写。`base` 是留下时层里的值（JSON 文本）：层里的值变了（恢复默认、别处改了）就
 * 作废，行回到实际值。切换标签、换分区时全部丢掉。
 */
const held = reactive(new Map<string, {readonly value: unknown; readonly base: string; readonly errors: ReadonlyArray<FormIssue>}>());
/** 解析不了的草稿（数字框里的 `abc`、写坏的 JSON），键是“配置键 + 字段路径”。 */
const unparseable = reactive(new Map<string, {readonly key: string; readonly issues: ReadonlyArray<FormIssue>}>());
watch([() => props.window.layer.value, () => props.view.id], () => {
    held.clear();
    unparseable.clear();
});

const json = (value: unknown): string => JSON.stringify(value) ?? "";

function heldOf(setting: WindowSetting, actual: unknown) {
    const entry = held.get(setting.definition.key);
    return entry !== undefined && entry.base === json(actual) ? entry : undefined;
}

async function write(setting: WindowSetting, value: unknown, actual: unknown): Promise<void> {
    const key = setting.definition.key;
    const form = formOf(setting);
    if (form.staged) {
        const errors = settingErrors(form, value);
        if (errors.length > 0) {
            held.set(key, {value, base: json(actual), errors});
            return;
        }
        // 改回了层里原来的值（例如删掉刚加的空项）：不用写，写了反倒把沿用的缺省值记成这一层改过。
        if (held.delete(key) && json(value) === json(actual)) return;
    }
    // 写入失败时不用通知表单：`commit: "change"` 的草稿在发出时已经丢掉，控件显示的就是传回来的实际值。
    await props.window.write(setting, value);
}

function shown(setting: WindowSetting, actual: unknown): unknown {
    const kept = heldOf(setting, actual);
    if (kept !== undefined) return kept.value;
    const pending = props.window.pending(setting.definition.key);
    return pending === undefined ? actual : pending.value;
}

function onDraft(setting: WindowSetting, state: DraftState): void {
    const id = `${setting.definition.key}\n${toPointer(state.path)}`;
    if (state.state === "unparseable" && state.issues.length > 0) unparseable.set(id, {key: setting.definition.key, issues: state.issues});
    else unparseable.delete(id);
}

/** 这一项为什么没写；都写了时为 null。只写第一条，多的看控件上的标记。 */
function notSaved(setting: WindowSetting, actual: unknown): string | null {
    const kept = heldOf(setting, actual);
    const value = kept?.value ?? actual;
    const issues = kept?.errors ?? [...unparseable.values()].filter((entry) => entry.key === setting.definition.key).flatMap((entry) => entry.issues);
    const [first] = describeIssues(setting.definition.declaration.schema, value, issues, locale.value, formOf(setting).hints);
    return first === undefined ? null : localize(formatText(TEXT.notSaved, {reason: first}), locale.value);
}

const describedby = (...ids: ReadonlyArray<string | undefined>) => ids.filter((id) => id !== undefined).join(" ") || undefined;

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
                <div class="settings-list-section__field">
                    <div class="settings-list-section__control" :data-settings-width="formOf(setting).wide ? undefined : formOf(setting).width">
                        <SchemaField
                            :id="row.id"
                            :schema="setting.definition.declaration.schema"
                            :hints="formOf(setting).hints"
                            :model-value="shown(setting, row.value)"
                            :locale="locale"
                            :disabled="row.disabled"
                            :labelledby="row.labelId"
                            :describedby="describedby(row.describedby, notSaved(setting, row.value) === null ? undefined : `${row.id}-not-saved`)"
                            bare
                            commit="change"
                            @update:model-value="(value: unknown) => write(setting, value, row.value)"
                            @draft-state="(state: DraftState) => onDraft(setting, state)"
                        />
                    </div>
                    <p v-if="notSaved(setting, row.value) !== null" :id="`${row.id}-not-saved`" class="settings-list-section__not-saved" data-settings-not-saved>{{ notSaved(setting, row.value) }}</p>
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

.settings-list-section__field {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex-direction: column;
    gap: var(--space-2);
}

.settings-list-section__not-saved {
    max-width: 32em;
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
    overflow-wrap: anywhere;
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
