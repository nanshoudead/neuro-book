<script setup lang="ts">
/**
 * 可搜索的下拉（同名 .md，docs/specs/ui/forms.md 输出 30）：一个 combobox 输入框加 `SuggestionMenu`。输入的文字只是
 * 搜索词，只有选中选项才改值；Escape 与失焦都恢复显示已选项。列表的样子、截断与滚动就是 `SuggestionMenu` 的，与
 * nb-ui 的其它弹出列表一致。
 *
 * 焦点一直在输入框里：`SuggestionMenu` 按下时不夺焦点，所以点选项不会先触发失焦；高亮经 `aria-activedescendant` 交给读屏。
 */
import {computed, ref, useId, watch} from "vue";

import SuggestionMenu from "../feedback/SuggestionMenu.vue";
import {suggestionMenuOptions, suggestionOptionId} from "../feedback/suggestion-menu";
import type {SuggestionMenuGroup} from "../feedback/suggestion-menu";
import {useFieldContext} from "./field-context";
import {moveHighlight} from "./option-highlight";
import type {HighlightAction} from "./option-highlight";

export type SearchSelectOption = {
    value: string;
    label: string;
    /** 右侧的一句说明；放不下时先截它。 */
    description?: string;
    iconClass?: string;
    disabled?: boolean;
};

export type SearchSelectSize = "default" | "sm";

const props = withDefaults(defineProps<{
    modelValue?: string;
    options: readonly SearchSelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    /** 没有匹配的选项时列表里的一行字，按显示语言传入。 */
    emptyText?: string;
    /** 选项列表的可访问名称；缺省时读屏用输入框的名字。 */
    listLabel?: string;
    size?: SearchSelectSize;
    disabled?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，不打开列表（输出 28）。 */
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    required?: boolean;
}>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    emptyText: "没有匹配的选项",
    listLabel: undefined,
    size: "default",
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFieldContext();
const generatedId = useId();
const controlId = computed(() => props.id || field?.inputId.value || `nb-search-select-${generatedId}`);
const menuId = computed(() => `${controlId.value}-listbox`);
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

const anchor = ref<HTMLElement | null>(null);
const open = ref(false);
/** 用户在输入框里打的字；没在搜索时为 null，输入框显示已选项的名字。 */
const query = ref<string | null>(null);
const activeId = ref<string | null>(null);

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const display = computed(() => query.value ?? selected.value?.label ?? "");

const filtered = computed(() => {
    const needle = (query.value ?? "").trim().toLocaleLowerCase();
    if (needle === "") return props.options;
    return props.options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
});
const groups = computed((): SuggestionMenuGroup[] => [{
    id: "options",
    items: filtered.value.map((option) => ({id: option.value, label: option.label, hint: option.description, iconClass: option.iconClass, disabled: option.disabled})),
}]);
const choosable = computed(() => suggestionMenuOptions(groups.value));
const activeDescendant = computed(() => {
    const index = choosable.value.findIndex((item) => item.id === activeId.value);
    return open.value && index >= 0 ? suggestionOptionId(menuId.value, index) : undefined;
});

/** 列表变了（换了搜索词或选项）：高亮还在就留着，不在了落到第一个可选项。 */
watch(choosable, (items) => {
    if (!items.some((item) => item.id === activeId.value)) activeId.value = items[0]?.id ?? null;
});

function openMenu(): void {
    if (props.disabled || props.readonly || open.value) return;
    open.value = true;
    activeId.value = selected.value !== undefined && selected.value.disabled !== true ? selected.value.value : choosable.value[0]?.id ?? null;
}

/** 关掉列表、丢掉搜索词：输入框回到显示已选项。 */
function closeMenu(): void {
    open.value = false;
    query.value = null;
}

function choose(value: string): void {
    const option = props.options.find((candidate) => candidate.value === value);
    if (option === undefined || option.disabled === true) return;
    closeMenu();
    if (value !== props.modelValue) emit("update:modelValue", value);
}

function move(action: HighlightAction): void {
    const items = choosable.value;
    const next = moveHighlight(items, items.findIndex((item) => item.id === activeId.value), action);
    activeId.value = next < 0 ? null : items[next]!.id;
}

function onInput(event: Event): void {
    if (props.readonly || props.disabled) return;
    query.value = (event.target as HTMLInputElement).value;
    if (!open.value) openMenu();
}

function onKeydown(event: KeyboardEvent): void {
    if (props.readonly || props.disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open.value) openMenu();
        else move(event.key === "ArrowDown" ? "next" : "prev");
    } else if (event.key === "Enter" && open.value) {
        event.preventDefault();
        if (activeId.value !== null) choose(activeId.value);
    } else if (event.key === "Escape" && open.value) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
    }
}

const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[length:var(--text-xs)]"
    : "nb-ui-control-h-md nb-ui-control-px text-[length:var(--text-sm)]");
</script>

<template>
    <div
        ref="anchor"
        class="nb-ui-control flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)]"
        :class="[controlSizeClass, isInvalid ? 'nb-ui-control-invalid' : '', props.disabled ? 'opacity-60' : '']"
        data-nb-search-select
    >
        <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        <input
            :id="controlId"
            :value="display"
            :name="props.name || undefined"
            :placeholder="props.placeholder"
            :disabled="props.disabled"
            :readonly="props.readonly"
            :required="props.required || field?.required.value"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-autocomplete="list"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="open ? menuId : undefined"
            :aria-activedescendant="activeDescendant"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            :aria-readonly="props.readonly || undefined"
            class="nb-ui-native-input min-w-0 flex-1 h-full bg-transparent text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
            @focus="emit('focus', $event)"
            @click="openMenu"
            @input="onInput"
            @keydown="onKeydown"
            @blur="closeMenu"
        >
        <span
            class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)]"
            :class="[isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4', open ? 'rotate-180' : '']"
            aria-hidden="true"
        ></span>
        <SuggestionMenu
            :id="menuId"
            :groups="groups"
            :active-id="activeId"
            :anchor="open ? anchor : null"
            :label="props.listLabel"
            :empty-text="props.emptyText"
            match-anchor-width
            @highlight="(id: string) => (activeId = id)"
            @select="choose"
        />
    </div>
</template>
