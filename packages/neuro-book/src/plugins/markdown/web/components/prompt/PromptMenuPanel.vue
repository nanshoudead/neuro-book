<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {Kbd, Spinner} from "@notnotype/nb-ui/components";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {promptText} from "./prompt-labels";
import type {PromptEditorMenuItem} from "./prompt-editor.types";

const props = withDefaults(defineProps<{
    id: string;
    locale: DisplayLocale;
    title?: string;
    items: readonly PromptEditorMenuItem[];
    activeId?: string | null;
    loading?: boolean;
    emptyText?: string;
    search?: string | null;
    searchLabel?: string;
}>(), {
    title: "",
    activeId: null,
    loading: false,
    emptyText: "",
    search: null,
    searchLabel: "",
});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "highlight", id: string): void;
    (e: "search", value: string): void;
    (e: "search-keydown", event: KeyboardEvent): void;
}>();

const listRef = ref<HTMLElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);

const rows = computed(() => props.items.map((item, index) => ({
    item,
    optionId: `${props.id}-${index}`,
    header: item.group && item.group !== props.items[index - 1]?.group ? item.group : null,
})));
const activeOptionId = computed(() => rows.value.find((row) => row.item.id === props.activeId)?.optionId);

watch(() => props.activeId, async () => {
    await nextTick();
    listRef.value?.querySelector("[aria-selected='true']")?.scrollIntoView({block: "nearest"});
});

function highlight(item: PromptEditorMenuItem): void {
    if (!item.disabled && item.id !== props.activeId) {
        emit("highlight", item.id);
    }
}

function select(item: PromptEditorMenuItem): void {
    if (!item.disabled) {
        emit("select", item.id);
    }
}

defineExpose({
    focusSearch(): void {
        searchRef.value?.focus();
    },
});
</script>

<template>
    <div class="prompt-menu" data-prompt-menu>
        <div v-if="props.search !== null" class="prompt-menu__search">
            <span class="prompt-menu__search-icon i-lucide-search" aria-hidden="true" />
            <input
                ref="searchRef"
                class="prompt-menu__search-input"
                type="text"
                :value="props.search"
                :placeholder="props.searchLabel"
                :aria-label="props.searchLabel"
                role="combobox"
                aria-expanded="true"
                :aria-controls="props.id"
                :aria-activedescendant="activeOptionId"
                autocomplete="off"
                spellcheck="false"
                @input="emit('search', ($event.target as HTMLInputElement).value)"
                @keydown="emit('search-keydown', $event)"
            >
        </div>
        <div v-if="props.title" class="prompt-menu__title">{{ props.title }}</div>
        <div :id="props.id" ref="listRef" class="prompt-menu__list" role="listbox" @mousedown.prevent>
            <template v-for="row in rows" :key="row.item.id">
                <div v-if="row.header" class="prompt-menu__group" role="presentation">{{ row.header }}</div>
                <div
                    :id="row.optionId"
                    class="prompt-menu__item"
                    :class="{'is-active': row.item.id === props.activeId, 'is-disabled': row.item.disabled}"
                    role="option"
                    :aria-selected="row.item.id === props.activeId"
                    :aria-disabled="row.item.disabled || undefined"
                    :data-prompt-menu-item="row.item.id"
                    @mousemove="highlight(row.item)"
                    @click="select(row.item)"
                >
                    <span v-if="row.item.iconClass" class="prompt-menu__icon" :class="row.item.iconClass" aria-hidden="true" />
                    <span class="prompt-menu__label">{{ row.item.label }}</span>
                    <span v-if="row.item.description" class="prompt-menu__description">{{ row.item.description }}</span>
                </div>
            </template>
            <div v-if="props.loading" class="prompt-menu__status" data-prompt-menu-status="loading">
                <Spinner size="sm" :label="promptText(props.locale, 'menuLoading')" show-label />
            </div>
            <div v-else-if="props.items.length === 0" class="prompt-menu__status" data-prompt-menu-status="empty">
                {{ props.emptyText || promptText(props.locale, "menuEmpty") }}
            </div>
        </div>
        <div class="prompt-menu__footer" aria-hidden="true" @mousedown.prevent>
            <span class="prompt-menu__hint"><Kbd size="sm">↑</Kbd><Kbd size="sm">↓</Kbd>{{ promptText(props.locale, "menuNavigate") }}</span>
            <span class="prompt-menu__hint"><Kbd size="sm">Enter</Kbd>{{ promptText(props.locale, "menuConfirm") }}</span>
            <span class="prompt-menu__hint"><Kbd size="sm">Esc</Kbd>{{ promptText(props.locale, "menuClose") }}</span>
        </div>
    </div>
</template>

<style scoped>
.prompt-menu {
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    background: var(--bg-panel);
    box-shadow: var(--elevation-popover);
    color: var(--text-main);
    font-size: 0.8125rem;
}

.prompt-menu__search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border-color);
}

.prompt-menu__search-icon {
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    color: var(--text-muted);
}

.prompt-menu__search-input {
    min-width: 0;
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    outline: none;
}

.prompt-menu__search-input::placeholder {
    color: var(--text-muted);
}

.prompt-menu__title {
    padding: 0.45rem 0.7rem 0.15rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
}

.prompt-menu__list {
    max-height: calc(8 * 2rem + 0.5rem);
    padding: 0.25rem;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.prompt-menu__group {
    padding: 0.4rem 0.5rem 0.15rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
}

.prompt-menu__item {
    display: flex;
    min-height: 2rem;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.5rem;
    border-radius: 0.4rem;
    cursor: pointer;
}

.prompt-menu__item.is-active {
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
}

.prompt-menu__item.is-disabled {
    cursor: default;
    opacity: 0.5;
}

.prompt-menu__icon {
    flex: none;
    width: 0.95rem;
    height: 0.95rem;
    color: var(--text-muted);
}

.prompt-menu__item.is-active .prompt-menu__icon {
    color: var(--accent-main);
}

.prompt-menu__label {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-menu__description {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-menu__status {
    display: flex;
    min-height: 2rem;
    align-items: center;
    padding: 0 0.5rem;
    color: var(--text-muted);
}

.prompt-menu__footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.3rem 0.6rem;
    border-top: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: 0.6875rem;
}

.prompt-menu__hint {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
}
</style>
