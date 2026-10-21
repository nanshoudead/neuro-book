<script setup lang="ts">
/**
 * 设置的一行（同名 .md）：按配置服务的 `inspect` 与当前标签算出控件、沿用说明、已修改、覆盖提示与停用；三种动作经传入的
 * 配置服务写这一层。规则见 docs/specs/settings/settings-window.md 输出 10–13、18。
 */
import {Button, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, useId} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import type {DeepReadonly, SettingDefinition, SettingLayer, SettingsFailure, SettingsService} from "nbook/shared/settings";

import {projectOverride, settingsRowState} from "./row-state";
import {settingAppliesText, settingValueText} from "./setting-text";

defineOptions({name: "SettingsRow"});

const props = withDefaults(defineProps<{
    settings: SettingsService;
    setting: SettingDefinition<unknown>;
    layer: SettingLayer;
    locale: DisplayLocale;
    projectTitle?: string | null;
    wide?: boolean;
}>(), {projectTitle: null, wide: false});

type RowAction = "reset" | "override" | "remove";

const emit = defineEmits<{
    (event: "write-failed", failure: {action: RowAction; code: SettingsFailure; detail: string}): void;
}>();

defineSlots<{
    /**
     * `id` 给控件，行的 `<label for>` 指向它；组合控件（单选组、复选组）拿不到 `<label for>` 的名字，用 `labelId` 作
     * `aria-labelledby`。`describedby` 是行里说明的 id，没有说明时为 undefined。
     */
    default(props: {value: unknown; disabled: boolean; id: string; label: string; labelId: string; describedby: string | undefined}): unknown;
}>();

const TEXT = {
    reset: {"zh-CN": "恢复默认", "en-US": "Reset to Default"},
    inherit: {"zh-CN": "沿用用户设置：{value}", "en-US": "Using your setting: {value}"},
    override: {"zh-CN": "在本作品里单独设置", "en-US": "Set for This Book"},
    remove: {"zh-CN": "移除本作品的设置", "en-US": "Remove Book Setting"},
    overridden: {"zh-CN": "本作品单独设为了 {value}，这里的改动在《{title}》里不生效", "en-US": "This book uses {value}; changes here don't apply to “{title}”"},
    overriddenUntitled: {"zh-CN": "本作品单独设为了 {value}，这里的改动在本作品里不生效", "en-US": "This book uses {value}; changes here don't apply to it"},
    userOnly: {"zh-CN": "只能在用户设置里改", "en-US": "Can only be changed in your settings"},
    projectOnly: {"zh-CN": "只能在本作品里设置", "en-US": "Can only be set for a book"},
} satisfies Record<string, LocalizedText>;

const text = (template: LocalizedText, params: Readonly<Record<string, string>> = {}): string => localize(formatText(template, params), props.locale);

const controlId = useId();
const labelId = `${controlId}-label`;
const descriptionId = `${controlId}-description`;
const appliesId = `${controlId}-applies`;
const declaration = computed(() => props.setting.declaration);
const inspection = computed(() => props.settings.inspect(props.setting));
const state = computed(() => settingsRowState(inspection.value, declaration.value.layers, props.layer));
const override = computed(() => projectOverride(inspection.value, declaration.value.layers, props.layer));
const title = computed(() => localize(declaration.value.title, props.locale));
const description = computed(() => (declaration.value.description === undefined ? null : localize(declaration.value.description, props.locale)));
const applies = computed(() => settingAppliesText(declaration.value.applies, props.locale));
const describedby = computed(() => [applies.value === null ? null : appliesId, description.value === null ? null : descriptionId].filter((id) => id !== null).join(" ") || undefined);
const modified = computed(() => state.value.kind === "edit" && state.value.written);
const blocked = computed(() => state.value.kind !== "not-allowed" && state.value.blocked);
const valueText = (value: unknown): string => settingValueText(declaration.value, value, props.locale);

/** 进行中的动作：同一行一次只发一个，按钮停用到它结算。 */
const busy = ref<RowAction | null>(null);

async function run(action: RowAction): Promise<void> {
    const current = state.value;
    if (busy.value !== null || current.kind === "not-allowed" || current.blocked) return;
    busy.value = action;
    try {
        const layer: SettingLayer = action === "reset" ? props.layer : "project";
        // 单独设置写的是此刻沿用的值；配置服务写入前会复制一份，冻结的读取结果可以直接交出去。
        const value = action === "override" && current.kind === "inherit" ? current.inherited as DeepReadonly<unknown> : undefined;
        const result = await props.settings.update(props.setting, value, {layer});
        if (!result.ok) emit("write-failed", {action, code: result.code, detail: result.detail});
    } finally {
        busy.value = null;
    }
}
</script>

<template>
    <div
        class="settings-row"
        :class="{'settings-row--wide': wide}"
        :data-settings-row="setting.key"
        :data-settings-row-state="state.kind"
        :data-settings-row-modified="modified ? '' : undefined"
        :data-settings-row-blocked="blocked ? '' : undefined"
    >
        <!-- 宽排法的竖线贴着整项，标签列加控件列的只贴着标题与说明（在标签里）。 -->
        <span v-if="modified && wide" class="settings-row__modified" aria-hidden="true"></span>
        <div class="settings-row__main">
            <div class="settings-row__label">
                <span v-if="modified && !wide" class="settings-row__modified" aria-hidden="true"></span>
                <!-- 生效时机不在 `<label>` 里：它不是控件的名字，经 `describedby` 当说明念（审查 S5 Sonnet 3）。 -->
                <div class="settings-row__title">
                    <label :id="labelId" :for="controlId">{{ title }}</label>
                    <span v-if="applies !== null" :id="appliesId" class="settings-row__applies">{{ applies }}</span>
                </div>
                <p v-if="description !== null" :id="descriptionId" class="settings-row__description">{{ description }}</p>
            </div>
            <div v-if="wide && modified" class="settings-row__head-action" data-settings-row-head>
                <Tooltip v-if="layer === 'user'" :text="text(TEXT.reset)">
                    <IconButton size="sm" icon-class="i-lucide-rotate-ccw" :aria-label="text(TEXT.reset)" :disabled="blocked || busy !== null" data-settings-row-reset @click="run('reset')" />
                </Tooltip>
                <Button v-else variant="ghost" size="sm" :disabled="blocked || busy !== null" data-settings-row-remove @click="run('remove')">{{ text(TEXT.remove) }}</Button>
            </div>
            <div v-if="!wide || state.kind !== 'edit'" class="settings-row__control">
                <template v-if="state.kind === 'edit'">
                    <slot :value="state.value" :disabled="blocked" :id="controlId" :label="title" :labelId="labelId" :describedby="describedby" />
                    <template v-if="modified">
                        <Tooltip v-if="layer === 'user'" :text="text(TEXT.reset)">
                            <IconButton size="sm" icon-class="i-lucide-rotate-ccw" :aria-label="text(TEXT.reset)" :disabled="blocked || busy !== null" data-settings-row-reset @click="run('reset')" />
                        </Tooltip>
                        <!-- 紧跟在控件后面：用有底色的按钮，免得读成横排单选组的又一项（审查 S5 Sonnet 7）。 -->
                        <Button v-else variant="secondary" size="sm" :disabled="blocked || busy !== null" data-settings-row-remove @click="run('remove')">{{ text(TEXT.remove) }}</Button>
                    </template>
                </template>
                <template v-else-if="state.kind === 'inherit'">
                    <span class="settings-row__inherit" data-settings-row-inherited>{{ text(TEXT.inherit, {value: valueText(state.inherited)}) }}</span>
                    <Button variant="secondary" size="sm" :disabled="blocked || busy !== null" data-settings-row-override @click="run('override')">{{ text(TEXT.override) }}</Button>
                </template>
                <span v-else class="settings-row__inherit">{{ text(layer === "project" ? TEXT.userOnly : TEXT.projectOnly) }}</span>
            </div>
        </div>
        <!-- 宽控件沿用时也画出来、停用：列表这类值一句摘要说不清沿用的是什么。 -->
        <div v-if="wide && state.kind !== 'not-allowed'" class="settings-row__wide" data-settings-row-wide>
            <slot :value="state.kind === 'edit' ? state.value : state.inherited" :disabled="state.kind === 'edit' ? blocked : true" :id="controlId" :label="title" :labelId="labelId" :describedby="describedby" />
        </div>
        <p v-if="override !== null" class="settings-row__override" data-settings-row-overridden>
            <span class="i-lucide-info settings-row__override-icon" aria-hidden="true"></span>
            <span>{{ text(projectTitle === null ? TEXT.overriddenUntitled : TEXT.overridden, {value: valueText(override.value), title: projectTitle ?? ""}) }}</span>
        </p>
    </div>
</template>

<style scoped>
.settings-row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block: var(--space-4);
}

.settings-row--wide {
    gap: var(--space-4);
}

/* 竖线画在行左边的留白里：放它的内容列要有不少于 --space-5 的左内边距。 */
.settings-row__modified {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--space-5) * -1);
    width: 2px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
}

.settings-row--wide > .settings-row__modified {
    top: var(--space-4);
    bottom: var(--space-4);
}

.settings-row__main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-7);
}

.settings-row__label {
    position: relative;
    width: 200px;
    min-width: 0;
    flex-shrink: 0;
}

.settings-row--wide .settings-row__label {
    width: auto;
    flex: 1;
}

.settings-row__title {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.settings-row__applies {
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.settings-row__description {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.settings-row__control {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.settings-row__head-action {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    align-self: flex-start;
}

.settings-row__wide {
    min-width: 0;
}

.settings-row__inherit {
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

.settings-row__override {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-info);
    overflow-wrap: anywhere;
}

.settings-row__override-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
    margin-top: var(--space-1);
}
</style>
